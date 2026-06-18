"""音符 / 和弦 -> MusicXML 五线谱。

将转写结果转为 MusicXML 4.0，供前端 OpenSheetMusicDisplay 渲染与导出。
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import List, Optional, Tuple

from .transcribe import RawChord, RawNote

DIVISIONS = 4  # 每四分音符的 division 数（十六分音符精度）
BEATS_PER_MEASURE = 4
DIVS_PER_MEASURE = BEATS_PER_MEASURE * DIVISIONS  # 16

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

CHORD_RE = re.compile(r"^([A-G])([#b]?)(m(in(or)?)?)?$", re.IGNORECASE)


def _grid_divs(quantize: str) -> int:
    """每个网格步长占多少 division。"""
    return {
        "quarter": 4,
        "eighth": 2,
        "sixteenth": 1,
        "none": 1,
    }.get(quantize, 1)


def _top_voice(notes: List[RawNote]) -> List[RawNote]:
    """重叠音符中只保留最高音，得到单声部旋律线。"""
    if not notes:
        return notes
    notes = sorted(notes, key=lambda n: (n.start, -n.midi))
    result: List[RawNote] = []
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
    # 非标准时值：用最大可整除单位拼接，这里简化为最接近的类型
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


def _append_pitch(note_el: ET.Element, midi: int) -> None:
    step, alter, octave = _midi_to_pitch(midi)
    pitch = _sub_element(note_el, "pitch")
    _sub_element(pitch, "step", step)
    if alter is not None:
        _sub_element(pitch, "alter", str(alter))
    _sub_element(pitch, "octave", str(octave))


def _append_rest(note_el: ET.Element, divs: int) -> None:
    _sub_element(note_el, "rest")
    _sub_element(note_el, "duration", str(divs))
    dtype, dots = _duration_info(divs)
    _sub_element(note_el, "type", dtype)
    if dots:
        for _ in range(dots):
            _sub_element(note_el, "dot")


def _append_note(note_el: ET.Element, midi: int, divs: int) -> None:
    _append_pitch(note_el, midi)
    _sub_element(note_el, "duration", str(divs))
    dtype, dots = _duration_info(divs)
    _sub_element(note_el, "type", dtype)
    if dots:
        for _ in range(dots):
            _sub_element(note_el, "dot")


def _append_harmony(parent: ET.Element, chord_name: str) -> None:
    step, alter, kind = _parse_chord(chord_name)
    harmony = _sub_element(parent, "harmony")
    root = _sub_element(harmony, "root")
    _sub_element(root, "root-step", step)
    if alter is not None:
        _sub_element(root, "root-alter", str(alter))
    _sub_element(harmony, "kind", kind)


def _snap_notes(
    notes: List[RawNote], tempo: float, quantize: str
) -> List[Tuple[int, int, int]]:
    """音符 -> [(start_div, end_div, midi), ...] 全局 division 索引。"""
    beat = 60.0 / max(tempo, 1.0)
    grid = _grid_divs(quantize)
    grid_dur = (grid / DIVISIONS) * beat

    out: List[Tuple[int, int, int]] = []
    for n in notes:
        start_div = int(round(n.start / grid_dur)) * grid
        end_div = max(start_div + grid, int(round(n.end / grid_dur)) * grid)
        out.append((start_div, end_div, n.midi))
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
    notes: List[Tuple[int, int, int]],
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


def _measure_elements(
    measure_idx: int,
    note_events: List[Tuple[int, int, int]],
    chord_events: List[Tuple[int, str]],
) -> List[ET.Element]:
    """生成一个小节内的 XML 元素列表（harmony + note）。"""
    m_start = measure_idx * DIVS_PER_MEASURE
    m_end = m_start + DIVS_PER_MEASURE

    occupancy: List[Optional[int]] = [None] * DIVS_PER_MEASURE
    for start, end, midi in note_events:
        if end <= m_start or start >= m_end:
            continue
        ls = max(start, m_start) - m_start
        le = min(end, m_end) - m_start
        for d in range(ls, le):
            occupancy[d] = midi

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
            midi = occupancy[pos]
            end = pos + 1
            while end < DIVS_PER_MEASURE and occupancy[end] == midi:
                end += 1
            dur = end - pos
            note_el = ET.Element("note")
            _append_note(note_el, midi, dur)
            elements.append(note_el)
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
                note_el = ET.Element("note")
                _append_rest(note_el, chunk)
                elements.append(note_el)
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


def build_musicxml(
    notes: List[RawNote],
    chords: List[RawChord],
    tempo: float,
    quantize: str = "none",
    title: str = "Transcription",
    duration: float = 0.0,
) -> str:
    """将音符与和弦转为 MusicXML 4.0 字符串。"""
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
    _sub_element(score_part, "part-name", "Melody")

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
            clef = _sub_element(attrs, "clef")
            _sub_element(clef, "sign", "G")
            _sub_element(clef, "line", "2")

            direction = _sub_element(measure, "direction", placement="above")
            dir_type = _sub_element(direction, "direction-type")
            metronome = _sub_element(dir_type, "metronome")
            _sub_element(metronome, "beat-unit", "quarter")
            _sub_element(metronome, "per-minute", str(int(round(tempo))))
            _sub_element(direction, "sound", tempo=str(tempo))

        for el in _measure_elements(m, snapped_notes, snapped_chords):
            measure.append(el)

    ET.indent(score, space="  ")
    xml_body = ET.tostring(score, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_body
