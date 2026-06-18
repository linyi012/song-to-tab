"""核心扒谱引擎：音频 -> 音符 / 和弦。

- realistic 引擎：librosa pYIN 单声部旋律识别（无重型依赖）。
- advanced 引擎：Spotify basic-pitch 多声部识别（可选安装）。

输出的音符 (midi, start, end, velocity) 之后会交给 tab.py 映射到吉他六线谱。
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass, field

from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np

from . import separate

SR = 22050  # 统一采样率
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
BEATS_PER_MEASURE = 4
CHORD_ROOT_RE = re.compile(r"^([A-G])([#b]?)(.*)$", re.IGNORECASE)
TRIAD_RE = re.compile(r"^[A-G][#b]?m?$")


def midi_to_name(midi: int) -> str:
    octave = midi // 12 - 1
    return f"{NOTE_NAMES[midi % 12]}{octave}"


@dataclass
class RawNote:
    midi: int
    start: float
    end: float
    velocity: float = 0.8


@dataclass
class RawChord:
    name: str
    start: float
    end: float


@dataclass
class EngineResult:
    notes: List[RawNote]
    chords: List[RawChord] = field(default_factory=list)
    tempo: float = 120.0
    duration: float = 0.0
    sample_rate: int = SR
    warnings: List[str] = field(default_factory=list)
    processed_audio: Optional[bytes] = None  # 分离后的 WAV 字节（若有）


# --------------------------------------------------------------------------- #
# 音频加载 / 基础分析
# --------------------------------------------------------------------------- #
def load_audio(path: str) -> Tuple[np.ndarray, int]:
    y, sr = librosa.load(path, sr=SR, mono=True)
    y, _ = librosa.effects.trim(y, top_db=40)
    return y, sr


def estimate_tempo(y: np.ndarray, sr: int) -> float:
    try:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(tempo)[0])
        if not math.isfinite(tempo) or tempo <= 0:
            return 120.0
        return round(tempo, 1)
    except Exception:
        return 120.0


# --------------------------------------------------------------------------- #
# 单声部旋律 (realistic)
# --------------------------------------------------------------------------- #
def detect_melody(
    y: np.ndarray,
    sr: int,
    fmin_note: str = "E2",
    fmax_note: str = "E6",
) -> List[RawNote]:
    """用 pYIN 估计基频，再把连续等高的帧合并为音符事件。"""
    fmin = librosa.note_to_hz(fmin_note)
    fmax = librosa.note_to_hz(fmax_note)
    hop = 512

    f0, voiced_flag, voiced_prob = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, hop_length=hop, fill_na=np.nan
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop)

    # 帧级能量，用作 velocity
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    if rms.max() > 0:
        rms = rms / rms.max()

    # 每帧 -> midi（无声为 -1）
    midi_seq = np.full(len(f0), -1, dtype=int)
    for i, (f, v) in enumerate(zip(f0, voiced_flag)):
        if v and f is not None and not np.isnan(f) and f > 0:
            midi_seq[i] = int(round(librosa.hz_to_midi(f)))

    notes: List[RawNote] = []
    cur_midi = -1
    start_idx = 0
    min_dur = 0.06  # 太短的音符丢弃，过滤抖动

    def flush(end_idx: int):
        nonlocal cur_midi, start_idx
        if cur_midi < 0:
            return
        t0 = float(times[start_idx])
        t1 = float(times[min(end_idx, len(times) - 1)])
        if t1 - t0 >= min_dur:
            seg = rms[start_idx:max(end_idx, start_idx + 1)]
            vel = float(np.clip(seg.mean() if len(seg) else 0.6, 0.1, 1.0))
            notes.append(RawNote(midi=cur_midi, start=t0, end=t1, velocity=vel))

    for i, m in enumerate(midi_seq):
        if m != cur_midi:
            flush(i)
            cur_midi = m
            start_idx = i
    flush(len(midi_seq) - 1)

    return _merge_close_notes(notes)


def _merge_close_notes(notes: List[RawNote], gap: float = 0.04) -> List[RawNote]:
    """合并相同音高、间隔很小的相邻音符。"""
    if not notes:
        return notes
    merged = [notes[0]]
    for n in notes[1:]:
        last = merged[-1]
        if n.midi == last.midi and n.start - last.end <= gap:
            last.end = n.end
            last.velocity = max(last.velocity, n.velocity)
        else:
            merged.append(n)
    return merged


# --------------------------------------------------------------------------- #
# 和弦识别 (medium)
# --------------------------------------------------------------------------- #
# 大三和弦 / 小三和弦模板（相对根音的半音集合）
_TRIADS = {
    "": [0, 4, 7],    # major
    "m": [0, 3, 7],   # minor
}

# 扩展和弦模板（rich 档）
_EXTENDED = {
    "maj7": [0, 4, 7, 11],
    "m7": [0, 3, 7, 10],
    "7": [0, 4, 7, 10],
    "sus4": [0, 5, 7],
    "dim": [0, 3, 6],
    "aug": [0, 4, 8],
}

_RICH_PREFERENCE_MARGIN = 0.05
_EXTENSION_BONUS = 0.03

_SUFFIX_TO_TRIAD = {
    "maj7": "",
    "7": "",
    "m7": "m",
    "sus4": "",
    "dim": "m",
    "aug": "",
}


def _is_triad_name(name: str) -> bool:
    return bool(TRIAD_RE.match(name))


def _build_chord_templates(rich: bool) -> Dict[str, np.ndarray]:
    suffix_map = dict(_TRIADS)
    if rich:
        suffix_map.update(_EXTENDED)
    templates: Dict[str, np.ndarray] = {}
    for root in range(12):
        for suffix, intervals in suffix_map.items():
            vec = np.zeros(12)
            for iv in intervals:
                vec[(root + iv) % 12] = 1.0
            templates[f"{NOTE_NAMES[root]}{suffix}"] = vec / np.linalg.norm(vec)
    return templates


def _select_chord_name(scores: Dict[str, float], rich: bool) -> Optional[str]:
    candidates = [(n, s) for n, s in scores.items() if s > 0.5]
    if not candidates:
        return None
    if not rich:
        return max(candidates, key=lambda x: x[1])[0]

    def adjusted(name: str, score: float) -> float:
        return score + (_EXTENSION_BONUS if not _is_triad_name(name) else 0.0)

    by_triad: Dict[str, List[Tuple[str, float]]] = {}
    for name, score in candidates:
        triad = strip_extensions(name)
        by_triad.setdefault(triad, []).append((name, score))

    best_name: Optional[str] = None
    best_adj = -1.0
    for triad, items in by_triad.items():
        triad_scores = [s for n, s in items if _is_triad_name(n)]
        triad_score = max(triad_scores) if triad_scores else max(s for _, s in items)
        chosen = triad
        chosen_score = triad_score
        for name, score in sorted(items, key=lambda x: x[1], reverse=True):
            if _is_triad_name(name):
                continue
            if score >= triad_score - _RICH_PREFERENCE_MARGIN:
                chosen = name
                chosen_score = score
                break
        adj = adjusted(chosen, chosen_score)
        if adj > best_adj:
            best_adj = adj
            best_name = chosen
    return best_name


def strip_extensions(name: str) -> str:
    """扩展和弦名 -> 三和弦名（如 Cmaj7 -> C，Bdim -> Bm）。"""
    m = CHORD_ROOT_RE.match(name.strip())
    if not m:
        return name
    root = m.group(1).upper()
    acc = m.group(2) or ""
    suffix = (m.group(3) or "").lower()
    if suffix in _SUFFIX_TO_TRIAD:
        return f"{root}{acc}{_SUFFIX_TO_TRIAD[suffix]}"
    if suffix in ("m", "min", "minor"):
        return f"{root}{acc}m"
    return f"{root}{acc}"


def simplify_chord_name(name: str, level: str) -> str:
    if level == "rich":
        return name
    base = strip_extensions(name)
    if level == "minimal":
        return re.sub(r"m$", "", base, flags=re.IGNORECASE)
    return base


def _merge_adjacent_same_chords(
    chords: List[RawChord], gap: float = 0.3
) -> List[RawChord]:
    if not chords:
        return []
    merged = [RawChord(name=chords[0].name, start=chords[0].start, end=chords[0].end)]
    for c in chords[1:]:
        last = merged[-1]
        if c.name == last.name and c.start - last.end < gap:
            last.end = c.end
        else:
            merged.append(RawChord(name=c.name, start=c.start, end=c.end))
    return merged


def merge_chords_by_density(
    chords: List[RawChord], tempo: float, level: str
) -> List[RawChord]:
    if not chords:
        return []
    if level in ("rich", "standard"):
        return _merge_adjacent_same_chords(chords)

    measure_sec = 60.0 / max(tempo, 1.0) * BEATS_PER_MEASURE
    window_sec = measure_sec if level == "simple" else measure_sec * 2
    end_time = chords[-1].end
    merged: List[RawChord] = []
    t = 0.0
    while t < end_time - 1e-6:
        w_end = min(t + window_sec, end_time)
        weights: Dict[str, float] = {}
        for c in chords:
            overlap = min(c.end, w_end) - max(c.start, t)
            if overlap > 0:
                weights[c.name] = weights.get(c.name, 0.0) + overlap
        if weights:
            best_name = max(weights, key=weights.get)
            merged.append(RawChord(name=best_name, start=t, end=w_end))
        t = w_end
    return _merge_adjacent_same_chords(merged)


def apply_chord_complexity(
    chords: List[RawChord], tempo: float, level: str
) -> List[RawChord]:
    if not chords:
        return []
    processed = [
        RawChord(
            name=simplify_chord_name(c.name, level),
            start=c.start,
            end=c.end,
        )
        for c in chords
    ]
    return merge_chords_by_density(processed, tempo, level)


def detect_chords(
    y: np.ndarray, sr: int, tempo: float, *, rich: bool = False
) -> List[RawChord]:
    """基于 chroma 的简易和弦识别，按拍分段做模板匹配。"""
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    times = librosa.times_like(chroma, sr=sr, hop_length=hop)

    # 用拍点分段；失败则用固定 1 秒窗
    try:
        _, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
        beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    except Exception:
        beat_times = np.array([])

    if len(beat_times) < 2:
        step = max(1.0, 60.0 / max(tempo, 1.0) * 2)
        beat_times = np.arange(0, times[-1] if len(times) else 0, step)

    templates = _build_chord_templates(rich)

    chords: List[RawChord] = []
    edges = list(beat_times) + [float(times[-1]) if len(times) else 0.0]
    for a, b in zip(edges[:-1], edges[1:]):
        if b - a < 0.15:
            continue
        mask = (times >= a) & (times < b)
        if not mask.any():
            continue
        seg = chroma[:, mask].mean(axis=1)
        norm = np.linalg.norm(seg)
        if norm < 1e-6:
            continue
        seg = seg / norm
        scores = {name: float(seg @ vec) for name, vec in templates.items()}
        best_name = _select_chord_name(scores, rich=rich)
        if best_name:
            if chords and chords[-1].name == best_name and a - chords[-1].end < 0.3:
                chords[-1].end = b
            else:
                chords.append(RawChord(name=best_name, start=float(a), end=float(b)))
    return chords


# --------------------------------------------------------------------------- #
# 多声部 (advanced, basic-pitch)
# --------------------------------------------------------------------------- #
def detect_polyphonic(path: str) -> Optional[List[RawNote]]:
    """使用 basic-pitch 做多声部识别；未安装则返回 None。"""
    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except Exception:
        return None

    try:
        _, _, note_events = predict(path, ICASSP_2022_MODEL_PATH)
    except Exception:
        try:
            _, _, note_events = predict(path)
        except Exception:
            return None

    notes: List[RawNote] = []
    # note_events: list of (start, end, pitch_midi, amplitude, [pitch_bends])
    for ev in note_events:
        start, end, pitch = float(ev[0]), float(ev[1]), int(ev[2])
        amp = float(ev[3]) if len(ev) > 3 else 0.8
        notes.append(
            RawNote(
                midi=pitch,
                start=start,
                end=end,
                velocity=float(np.clip(amp, 0.1, 1.0)),
            )
        )
    notes.sort(key=lambda n: (n.start, n.midi))
    return notes


# --------------------------------------------------------------------------- #
# 节奏量化
# --------------------------------------------------------------------------- #
_GRID = {"quarter": 1.0, "eighth": 0.5, "sixteenth": 0.25}


def quantize_notes(
    notes: List[RawNote], tempo: float, grid: str
) -> List[RawNote]:
    if grid not in _GRID or not notes:
        return notes
    beat = 60.0 / max(tempo, 1.0)
    step = beat * _GRID[grid]
    if step <= 0:
        return notes
    out: List[RawNote] = []
    for n in notes:
        s = round(n.start / step) * step
        e = round(n.end / step) * step
        if e <= s:
            e = s + step  # 至少一个网格长度
        out.append(RawNote(midi=n.midi, start=s, end=e, velocity=n.velocity))
    return out


# --------------------------------------------------------------------------- #
# 顶层调度
# --------------------------------------------------------------------------- #
def _detect_and_process_chords(
    y: np.ndarray, sr: int, tempo: float, chord_complexity: str
) -> List[RawChord]:
    rich = chord_complexity == "rich"
    raw = detect_chords(y, sr, tempo, rich=rich)
    return apply_chord_complexity(raw, tempo, chord_complexity)


def transcribe(
    path: str,
    engine: str = "realistic",
    degree: str = "simple",
    quantize: str = "none",
    separate_mode: str = "none",
    chord_complexity: str = "standard",
) -> EngineResult:
    warnings: List[str] = []
    work_path = path
    separated_path: Optional[str] = None

    if separate_mode != "none":
        if separate.separate_available():
            separated_path, sep_warn = separate.run_separation(path, separate_mode)
            if sep_warn:
                warnings.append(sep_warn)
            elif separated_path and separated_path != path:
                work_path = separated_path
        else:
            reason = separate.separate_unavailable_reason()
            warnings.append(
                reason or "人声分离不可用，已跳过人声分离。"
            )

    try:
        y, sr = load_audio(work_path)
        duration = float(len(y) / sr) if sr else 0.0
        tempo = estimate_tempo(y, sr)
        notes: List[RawNote] = []
        chords: List[RawChord] = []

        if degree == "chords":
            chords = _detect_and_process_chords(y, sr, tempo, chord_complexity)
            if not chords:
                warnings.append(
                    "未能识别到清晰和弦，请尝试伴奏更明显的音频，"
                    "或使用「去人声」分离后再试。"
                )
        else:
            use_advanced = engine == "advanced"
            if use_advanced:
                poly = detect_polyphonic(work_path)
                if poly is None:
                    warnings.append(
                        "未检测到 basic-pitch，已回退到务实(单声部)引擎。"
                        "安装方式：pip install \"basic-pitch[onnx]\""
                    )
                    use_advanced = False
                else:
                    notes = poly

            if not use_advanced:
                notes = detect_melody(y, sr)

            # 扒谱程度处理
            if degree == "simple":
                notes = _top_voice(notes)  # 仅保留单声部主旋律
            elif degree == "medium":
                if not use_advanced:
                    notes = _top_voice(notes)
                chords = _detect_and_process_chords(y, sr, tempo, chord_complexity)
            elif degree == "full":
                if not use_advanced:
                    warnings.append(
                        "full 程度的多声部需要进阶引擎(basic-pitch)；"
                        "务实引擎下仍以单声部旋律输出。"
                    )
                chords = _detect_and_process_chords(y, sr, tempo, chord_complexity)

            notes = quantize_notes(notes, tempo, quantize)
            notes.sort(key=lambda n: (n.start, n.midi))

            if not notes:
                warnings.append("未能识别到清晰音符，请尝试更干净/单声部的音频。")

        processed_audio: Optional[bytes] = None
        if separated_path and separated_path != path and os.path.exists(separated_path):
            with open(separated_path, "rb") as f:
                processed_audio = f.read()

        return EngineResult(
            notes=notes,
            chords=chords,
            tempo=tempo,
            duration=duration,
            sample_rate=sr,
            warnings=warnings,
            processed_audio=processed_audio,
        )
    finally:
        if separated_path and separated_path != path and os.path.exists(separated_path):
            try:
                os.remove(separated_path)
            except OSError:
                pass


def _top_voice(notes: List[RawNote]) -> List[RawNote]:
    """在重叠音符中只保留最高音，得到单声部旋律线。"""
    if not notes:
        return notes
    notes = sorted(notes, key=lambda n: (n.start, -n.midi))
    result: List[RawNote] = []
    for n in notes:
        if result and n.start < result[-1].end - 1e-3:
            # 与上一个音符重叠：保留较高者
            if n.midi > result[-1].midi:
                result[-1].end = min(result[-1].end, n.start)
                if result[-1].end <= result[-1].start:
                    result.pop()
                result.append(n)
            # 否则丢弃当前较低音
        else:
            result.append(n)
    return [n for n in result if n.end > n.start]
