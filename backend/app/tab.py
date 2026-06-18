"""音符 -> 吉他六线谱 (TAB)。

标准调弦（从最低音 6 弦到最高音 1 弦）：E2 A2 D3 G3 B3 E4
内部弦号 0..5 对应 MIDI 起始音 [40, 45, 50, 55, 59, 64]。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional

from .models import Chord, Note
from .transcribe import RawChord, RawNote, midi_to_name

# 标准调弦，每根弦空弦 MIDI（index 0 = 最低音 E 弦）
STANDARD_TUNING = [40, 45, 50, 55, 59, 64]
TUNING_NAMES = ["E", "A", "D", "G", "B", "E"]  # 6→1 弦
MAX_FRET = 22


@dataclass
class Placement:
    string: int  # 0..5
    fret: int


def _candidates(midi: int) -> List[Placement]:
    """某个音高在指板上所有可行的 (弦, 品) 位置。"""
    out: List[Placement] = []
    for s, open_midi in enumerate(STANDARD_TUNING):
        fret = midi - open_midi
        if 0 <= fret <= MAX_FRET:
            out.append(Placement(string=s, fret=fret))
    return out


def assign_positions(notes: List[RawNote]) -> List[Note]:
    """为每个音符选择弦/品，尽量靠近上一个把位、品格数较小。"""
    result: List[Note] = []
    prev_fret: Optional[int] = None

    for n in notes:
        cands = _candidates(n.midi)
        if not cands:
            # 超出吉他音域：夹到最近八度
            midi = n.midi
            while midi < STANDARD_TUNING[0] and midi + 12 <= STANDARD_TUNING[-1] + MAX_FRET:
                midi += 12
            while midi > STANDARD_TUNING[-1] + MAX_FRET and midi - 12 >= STANDARD_TUNING[0]:
                midi -= 12
            cands = _candidates(midi)
            if not cands:
                continue

        def cost(p: Placement) -> float:
            c = p.fret  # 偏好低品
            if prev_fret is not None and p.fret > 0:
                c += 0.6 * abs(p.fret - prev_fret)  # 偏好靠近上一把位
            if p.fret == 0:
                c -= 0.5  # 略偏好空弦
            return c

        best = min(cands, key=cost)
        if best.fret > 0:
            prev_fret = best.fret

        result.append(
            Note(
                midi=n.midi,
                name=midi_to_name(n.midi),
                start=round(n.start, 3),
                end=round(n.end, 3),
                velocity=round(n.velocity, 2),
                string=best.string,
                fret=best.fret,
            )
        )
    return result


def chords_to_models(chords: List[RawChord]) -> List[Chord]:
    return [
        Chord(name=c.name, start=round(c.start, 3), end=round(c.end, 3))
        for c in chords
    ]


# --------------------------------------------------------------------------- #
# ASCII 六线谱渲染
# --------------------------------------------------------------------------- #
def render_ascii_tab(
    notes: List[Note],
    tempo: float,
    chords: Optional[List[Chord]] = None,
    beats_per_measure: int = 4,
    cols_per_beat: int = 4,
    measures_per_line: int = 4,
) -> str:
    """把音符按时间网格排成六线谱字符串。

    顶行为 1 弦(高音 e)，底行为 6 弦(低音 E)，符合常规阅读习惯。
    仅和弦模式（notes 为空、chords 非空）时输出空六线谱 + 和弦名行。
    """
    if not notes and not chords:
        return "（无音符）"

    beat = 60.0 / max(tempo, 1.0)
    col_dur = beat / cols_per_beat
    if notes:
        end_time = max(n.end for n in notes)
    else:
        end_time = max(c.end for c in chords or [])
    total_cols = max(1, int(round(end_time / col_dur)) + 1)
    cols_per_measure = beats_per_measure * cols_per_beat

    # 6 行字符网格，行 0 = 1 弦(高音)。内部 string 0..5 = 低→高，需翻转。
    grid: List[List[str]] = [["-"] * total_cols for _ in range(6)]
    width = [1] * total_cols  # 每列字符宽度（两位品需要 2 格）

    for n in notes:
        col = int(round(n.start / col_dur))
        col = min(max(col, 0), total_cols - 1)
        row = 5 - n.string  # 翻转：高音弦在顶部
        token = str(n.fret)
        grid[row][col] = token
        width[col] = max(width[col], len(token))

    # 和弦标注行（按列）
    chord_row = [""] * total_cols
    if chords:
        for ch in chords:
            col = min(max(int(round(ch.start / col_dur)), 0), total_cols - 1)
            if not chord_row[col]:
                chord_row[col] = ch.name
                width[col] = max(width[col], len(ch.name))

    # 组装：按行 -> 按小节分行块
    string_labels = ["e", "B", "G", "D", "A", "E"]  # 顶→底
    lines: List[str] = []

    cols_per_block = cols_per_measure * measures_per_line
    for block_start in range(0, total_cols, cols_per_block):
        block_end = min(block_start + cols_per_block, total_cols)

        # 和弦行
        chord_line = "    "
        for c in range(block_start, block_end):
            w = width[c]
            cell = chord_row[c][:w].ljust(w) if chord_row[c] else " " * w
            chord_line += cell
            if (c + 1) % cols_per_measure == 0:
                chord_line += " "
        if chord_line.strip():
            lines.append(chord_line.rstrip())

        # 六根弦
        for row in range(6):
            line = f"{string_labels[row]} |"
            for c in range(block_start, block_end):
                w = width[c]
                cell = grid[row][c]
                cell = cell.rjust(w, "-") if cell != "-" else "-" * w
                line += cell + "-"
                if (c + 1) % cols_per_measure == 0:
                    line += "|"
            lines.append(line)
        lines.append("")  # 块间空行

    header = f"Tempo ≈ {tempo:.0f} BPM   调弦: EADGBE   ({beats_per_measure}/4)"
    return header + "\n\n" + "\n".join(lines).rstrip()


def count_measures(
    notes: List[Note],
    tempo: float,
    chords: Optional[List[Chord]] = None,
    beats_per_measure: int = 4,
) -> int:
    if not notes and not chords:
        return 0
    beat = 60.0 / max(tempo, 1.0)
    if notes:
        end_time = max(n.end for n in notes)
    else:
        end_time = max(c.end for c in chords or [])
    return max(1, int(end_time / (beat * beats_per_measure)) + 1)
