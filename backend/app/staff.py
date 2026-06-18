"""音符 / 和弦 -> MusicXML（双谱表五线谱+TAB / 纯 TAB）。

将转写结果转为 MusicXML 4.0，供前端 OpenSheetMusicDisplay 渲染与导出。
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import List, Literal, Optional, Tuple

from .models import Note
from .transcribe import RawChord

DIVISIONS = 4  # 每四分音符的 division 数（十六分音符精度）
BEATS_PER_MEASURE = 4
DIVS_PER_MEASURE = BEATS_PER_MEASURE * DIVISIONS  # 16

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

CHORD_RE = re.compile(r"^([A-G])([#b]?)(m(in(or)?)?)?$", re.IGNORECASE)

# TAB 谱表调弦：line 1 = 高音 e 弦 … line 6 = 低音 E 弦
TAB_TUNING: List[Tuple[str, int]] = [
    ("E", 4),
    ("B", 3),
    ("G", 3),
    ("D", 3),
    ("A", 2),
    ("E", 2),
]

StaffMode = Literal["staff", "dual", "tab"]


def _grid_divs(quantize: str) -> int:
    """每个网格步长占多少 division。"""
    return {
        "quarter": 4,
        "eighth": 2,
        "sixteenth": 1,
        "none": 1,
    }.get(quantize, 1)


def _top_voice(notes: List[Note]) -> List[Note]:
    """重叠音符中只保留最高音，得到单声部旋律线。"""
    if not notes:
        return notes
    notes = sorted(notes, key=lambda n: (n.start, -n.midi))
    result: List[Note] = []
    for n in notes:
        if result and n.start < result[-1].end - 1e-3:
            if n.midi > result[-1].midi:
                result[-1].end = min(result[-1].end, n.start)
                if result[-1].end <= result[-1].start:
                    result.pop()
                result.append(n)
        else:
            result.append(n)
    return [n for n in result if n.end > n.start]


def _note_key(n: Optional[Note]) -> Optional[Tuple[int, int, int]]:
    if n is None:
        return None
    return (n.midi, n.string, n.fret)


def _midi_to_pitch(midi: int) -> Tuple[str, Optional[int], int]:
    """MIDI -> (step, alter, octave)。"""
    pc = midi % 12
    octave = midi // 12 - 1
    name = NOTE_NAMES[pc]
    step = name[0]
    alter: Optional[int] = None
    if len(name) == 2:
        alter = 1 if name[1] == "#" else -1
    return step, alter, octave


def _parse_chord(name: str) -> Tuple[str, Optional[int], str]:
    """和弦名 -> (root_step, root_alter, kind)。"""
    m = CHORD_RE.match(name.strip())
    if not m:
        return "C", None, "major"
    step = m.group(1).upper()
    acc = m.group(2)
    alter: Optional[int] = None
    if acc == "#":
        alter = 1
    elif acc == "b":
        alter = -1
    kind = "minor" if m.group(3) else "major"
    return step, alter, kind


def _duration_info(divs: int) -> Tuple[str, Optional[int]]:
    """division 数 -> (type, dots)。"""
    mapping = {
        16: ("whole", None),
        12: ("half", 1),
        8: ("half", None),
        6: ("quarter", 1),
        4: ("quarter", None),
        3: ("eighth", 1),
        2: ("eighth", None),
        1: ("16th", None),
    }
    if divs in mapping:
        return mapping[divs]
    if divs >= 16:
        return "whole", None
    if divs >= 8:
        return "half", None
    if divs >= 4:
        return "quarter", None
    if divs >= 2:
        return "eighth", None
    return "16th", None


def _sub_element(parent: ET.Element, tag: str, text: Optional[str] = None, **attrs: str) -> ET.Element:
    el = ET.SubElement(parent, tag, attrs)
    if text is not None:
        el.text = text
    return el


def _append_duration_type(note_el: ET.Element, divs: int) -> None:
    _sub_element(note_el, "duration", str(divs))
    dtype, dots = _duration_info(divs)
    _sub_element(note_el, "type", dtype)
    if dots:
        for _ in range(dots):
            _sub_element(note_el, "dot")


def _append_pitch(note_el: ET.Element, midi: int) -> None:
    step, alter, octave = _midi_to_pitch(midi)
    pitch = _sub_element(note_el, "pitch")
    _sub_element(pitch, "step", step)
    if alter is not None:
        _sub_element(pitch, "alter", str(alter))
    _sub_element(pitch, "octave", str(octave))


def _append_rest(note_el: ET.Element, divs: int, staff: Optional[int] = None) -> None:
    if staff is not None:
        _sub_element(note_el, "staff", str(staff))
    _sub_element(note_el, "voice", "1")
    _sub_element(note_el, "rest")
    _append_duration_type(note_el, divs)


def _append_note(
    note_el: ET.Element,
    midi: int,
    divs: int,
    staff: Optional[int] = None,
    with_tab: bool = False,
    tab_note: Optional[Note] = None,
) -> None:
    if staff is not None:
        _sub_element(note_el, "staff", str(staff))
    _sub_element(note_el, "voice", "1")
    _append_pitch(note_el, midi)
    _append_duration_type(note_el, divs)
    if with_tab and tab_note is not None:
        _append_tab_technical(note_el, tab_note)


def _append_tab_technical(note_el: ET.Element, note: Note) -> None:
    notations = _sub_element(note_el, "notations")
    technical = _sub_element(notations, "technical")
    _sub_element(technical, "string", str(6 - note.string))
    _sub_element(technical, "fret", str(note.fret))


def _append_harmony(parent: ET.Element, chord_name: str) -> None:
    step, alter, kind = _parse_chord(chord_name)
    harmony = _sub_element(parent, "harmony")
    root = _sub_element(harmony, "root")
    _sub_element(root, "root-step", step)
    if alter is not None:
        _sub_element(root, "root-alter", str(alter))
    _sub_element(harmony, "kind", kind)


def _append_staff_tuning(attrs: ET.Element, staff_number: str) -> None:
    for line, (step, octave) in enumerate(TAB_TUNING, start=1):
        tuning = _sub_element(attrs, "staff-tuning", number=staff_number, line=str(line))
        _sub_element(tuning, "tuning-step", step)
        _sub_element(tuning, "tuning-octave", str(octave))


def _append_staff_attributes(attrs: ET.Element) -> None:
    clef = _sub_element(attrs, "clef")
    _sub_element(clef, "sign", "G")
    _sub_element(clef, "line", "2")


def _append_tab_staff_attributes(attrs: ET.Element) -> None:
    clef = _sub_element(attrs, "clef")
    _sub_element(clef, "sign", "TAB")
    _sub_element(clef, "line", "5")
    details = _sub_element(attrs, "staff-details")
    _sub_element(details, "staff-type", "tab")
    _sub_element(details, "staff-lines", "6")
    _append_staff_tuning(attrs, "1")


def _append_dual_staff_attributes(attrs: ET.Element) -> None:
    _sub_element(attrs, "staves", "2")
    clef1 = _sub_element(attrs, "clef", number="1")
    _sub_element(clef1, "sign", "G")
    _sub_element(clef1, "line", "2")
    clef2 = _sub_element(attrs, "clef", number="2")
    _sub_element(clef2, "sign", "TAB")
    _sub_element(clef2, "line", "5")
    details = _sub_element(attrs, "staff-details", number="2")
    _sub_element(details, "staff-type", "tab")
    _sub_element(details, "staff-lines", "6")
    _append_staff_tuning(attrs, "2")


def _append_backup(elements: List[ET.Element], dur: int) -> None:
    backup = ET.Element("backup")
    _sub_element(backup, "duration", str(dur))
    elements.append(backup)


def _snap_notes(
    notes: List[Note], tempo: float, quantize: str
) -> List[Tuple[int, int, Note]]:
    """音符 -> [(start_div, end_div, note), ...] 全局 division 索引。"""
    beat = 60.0 / max(tempo, 1.0)
    grid = _grid_divs(quantize)
    grid_dur = (grid / DIVISIONS) * beat

    out: List[Tuple[int, int, Note]] = []
    for n in notes:
        start_div = int(round(n.start / grid_dur)) * grid
        end_div = max(start_div + grid, int(round(n.end / grid_dur)) * grid)
        out.append((start_div, end_div, n))
    return sorted(out, key=lambda x: x[0])


def _snap_chords(
    chords: List[RawChord], tempo: float, quantize: str
) -> List[Tuple[int, str]]:
    """和弦 -> [(start_div, name), ...]。"""
    beat = 60.0 / max(tempo, 1.0)
    grid = _grid_divs(quantize)
    grid_dur = (grid / DIVISIONS) * beat
    out: List[Tuple[int, str]] = []
    for c in chords:
        start_div = int(round(c.start / grid_dur)) * grid
        out.append((start_div, c.name))
    return sorted(out, key=lambda x: x[0])


def _total_divs(
    notes: List[Tuple[int, int, Note]],
    chords: List[Tuple[int, str]],
    tempo: float,
    duration: float,
) -> int:
    max_div = 0
    for start, end, _ in notes:
        max_div = max(max_div, end)
    for start, _ in chords:
        max_div = max(max_div, start + DIVISIONS)
    if duration > 0:
        beat = 60.0 / max(tempo, 1.0)
        max_div = max(max_div, int(round(duration / beat)) * DIVISIONS)
    return max(max_div, DIVS_PER_MEASURE)


def _emit_note_pair(elements: List[ET.Element], note: Note, dur: int) -> None:
    """双谱表：谱表 1 音符后 backup，再写谱表 2（MuseScore 需要时间对齐）。"""
    staff1 = ET.Element("note")
    _append_note(staff1, note.midi, dur, staff=1)
    elements.append(staff1)

    _append_backup(elements, dur)

    staff2 = ET.Element("note")
    _append_note(staff2, note.midi, dur, staff=2, with_tab=True, tab_note=note)
    elements.append(staff2)


def _emit_rest_pair(elements: List[ET.Element], dur: int) -> None:
    staff1 = ET.Element("note")
    _append_rest(staff1, dur, staff=1)
    elements.append(staff1)

    _append_backup(elements, dur)

    staff2 = ET.Element("note")
    _append_rest(staff2, dur, staff=2)
    elements.append(staff2)


def _emit_staff_note(elements: List[ET.Element], note: Note, dur: int) -> None:
    note_el = ET.Element("note")
    _append_note(note_el, note.midi, dur)
    elements.append(note_el)


def _emit_staff_rest(elements: List[ET.Element], dur: int) -> None:
    note_el = ET.Element("note")
    _append_rest(note_el, dur)
    elements.append(note_el)


def _emit_tab_note(elements: List[ET.Element], note: Note, dur: int) -> None:
    note_el = ET.Element("note")
    _append_note(note_el, note.midi, dur, with_tab=True, tab_note=note)
    elements.append(note_el)


def _emit_tab_rest(elements: List[ET.Element], dur: int) -> None:
    note_el = ET.Element("note")
    _append_rest(note_el, dur)
    elements.append(note_el)


def _measure_elements(
    measure_idx: int,
    note_events: List[Tuple[int, int, Note]],
    chord_events: List[Tuple[int, str]],
    mode: StaffMode,
) -> List[ET.Element]:
    """生成一个小节内的 XML 元素列表（harmony + note）。"""
    m_start = measure_idx * DIVS_PER_MEASURE
    m_end = m_start + DIVS_PER_MEASURE

    occupancy: List[Optional[Note]] = [None] * DIVS_PER_MEASURE
    for start, end, note in note_events:
        if end <= m_start or start >= m_end:
            continue
        ls = max(start, m_start) - m_start
        le = min(end, m_end) - m_start
        for d in range(ls, le):
            occupancy[d] = note

    chord_at: dict[int, str] = {}
    for pos, name in chord_events:
        if m_start <= pos < m_end:
            chord_at[pos - m_start] = name

    elements: List[ET.Element] = []
    pos = 0
    while pos < DIVS_PER_MEASURE:
        if pos in chord_at:
            h = ET.Element("harmony")
            _append_harmony(h, chord_at[pos])
            elements.append(h)

        if occupancy[pos] is not None:
            note = occupancy[pos]
            key = _note_key(note)
            end = pos + 1
            while end < DIVS_PER_MEASURE and _note_key(occupancy[end]) == key:
                end += 1
            dur = end - pos
            if mode == "dual":
                _emit_note_pair(elements, note, dur)
            elif mode == "tab":
                _emit_tab_note(elements, note, dur)
            else:
                _emit_staff_note(elements, note, dur)
            pos = end
        else:
            end = pos + 1
            while (
                end < DIVS_PER_MEASURE
                and occupancy[end] is None
                and end not in chord_at
            ):
                end += 1
            rest_dur = end - pos
            for chunk in _split_duration(rest_dur):
                if mode == "dual":
                    _emit_rest_pair(elements, chunk)
                elif mode == "tab":
                    _emit_tab_rest(elements, chunk)
                else:
                    _emit_staff_rest(elements, chunk)
            pos = end

    return elements


def _split_duration(divs: int) -> List[int]:
    """将任意 division 长度拆为标准时值片段。"""
    if divs <= 0:
        return [1]
    chunks: List[int] = []
    remaining = divs
    while remaining > 0:
        for candidate in (16, 8, 4, 2, 1):
            if candidate <= remaining:
                chunks.append(candidate)
                remaining -= candidate
                break
        else:
            chunks.append(1)
            remaining -= 1
    return chunks


def _build_musicxml(
    notes: List[Note],
    chords: List[RawChord],
    tempo: float,
    quantize: str,
    title: str,
    duration: float,
    mode: StaffMode,
) -> str:
    if not notes and not chords:
        return ""

    mono = _top_voice(notes)
    snapped_notes = _snap_notes(mono, tempo, quantize)
    snapped_chords = _snap_chords(chords, tempo, quantize)
    total = _total_divs(snapped_notes, snapped_chords, tempo, duration)
    num_measures = max(1, (total + DIVS_PER_MEASURE - 1) // DIVS_PER_MEASURE)

    score = ET.Element("score-partwise", version="4.0")
    work = _sub_element(score, "work")
    _sub_element(work, "work-title", title)

    part_list = _sub_element(score, "part-list")
    score_part = _sub_element(part_list, "score-part", id="P1")
    part_name = {
        "tab": "Guitar TAB",
        "dual": "Guitar",
        "staff": "Melody",
    }[mode]
    _sub_element(score_part, "part-name", part_name)

    part = _sub_element(score, "part", id="P1")

    for m in range(num_measures):
        measure = _sub_element(part, "measure", number=str(m + 1))

        if m == 0:
            attrs = _sub_element(measure, "attributes")
            _sub_element(attrs, "divisions", str(DIVISIONS))
            key = _sub_element(attrs, "key")
            _sub_element(key, "fifths", "0")
            time_el = _sub_element(attrs, "time")
            _sub_element(time_el, "beats", str(BEATS_PER_MEASURE))
            _sub_element(time_el, "beat-type", "4")
            if mode == "dual":
                _append_dual_staff_attributes(attrs)
            elif mode == "tab":
                _append_tab_staff_attributes(attrs)
            else:
                _append_staff_attributes(attrs)

            direction = _sub_element(measure, "direction", placement="above")
            dir_type = _sub_element(direction, "direction-type")
            metronome = _sub_element(dir_type, "metronome")
            _sub_element(metronome, "beat-unit", "quarter")
            _sub_element(metronome, "per-minute", str(int(round(tempo))))
            _sub_element(direction, "sound", tempo=str(tempo))

        for el in _measure_elements(m, snapped_notes, snapped_chords, mode):
            measure.append(el)

    ET.indent(score, space="  ")
    xml_body = ET.tostring(score, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_body


def build_staff_musicxml(
    notes: List[Note],
    chords: List[RawChord],
    tempo: float,
    quantize: str = "none",
    title: str = "Transcription",
    duration: float = 0.0,
) -> str:
    """将音符与和弦转为单声部五线谱 MusicXML 4.0 字符串。"""
    return _build_musicxml(notes, chords, tempo, quantize, title, duration, mode="staff")


def build_dual_musicxml(
    notes: List[Note],
    chords: List[RawChord],
    tempo: float,
    quantize: str = "none",
    title: str = "Transcription",
    duration: float = 0.0,
) -> str:
    """将已定位的音符与和弦转为双谱表（五线谱 + TAB）MusicXML 4.0 字符串。"""
    return _build_musicxml(notes, chords, tempo, quantize, title, duration, mode="dual")


def build_musicxml(
    notes: List[Note],
    chords: List[RawChord],
    tempo: float,
    quantize: str = "none",
    title: str = "Transcription",
    duration: float = 0.0,
) -> str:
    """兼容别名：双谱表 MusicXML。"""
    return build_dual_musicxml(notes, chords, tempo, quantize, title, duration)


def build_tab_musicxml(
    notes: List[Note],
    chords: List[RawChord],
    tempo: float,
    quantize: str = "none",
    title: str = "Transcription",
    duration: float = 0.0,
) -> str:
    """将已定位的音符与和弦转为纯 TAB 谱表 MusicXML 4.0 字符串。"""
    return _build_musicxml(notes, chords, tempo, quantize, title, duration, mode="tab")
