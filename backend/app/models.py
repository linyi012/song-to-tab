"""Pydantic schemas shared across the API."""
from __future__ import annotations

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Engine(str, Enum):
    """扒谱引擎。"""

    realistic = "realistic"  # 务实：librosa 单声部旋律
    advanced = "advanced"    # 进阶：basic-pitch 多声部（需可选安装）


class Degree(str, Enum):
    """扒谱程度。"""

    simple = "simple"  # 只扒主旋律
    chords = "chords"  # 只扒和弦（无单音旋律）
    medium = "medium"  # 旋律 + 主要和弦
    full = "full"      # 尽可能多的音符


class Quantize(str, Enum):
    """节奏量化网格。"""

    none = "none"
    quarter = "quarter"      # 1/4
    eighth = "eighth"        # 1/8
    sixteenth = "sixteenth"  # 1/16


class Separate(str, Enum):
    """Demucs 音源分离预处理。"""

    none = "none"              # 不分离
    no_vocals = "no_vocals"    # 去人声，保留伴奏
    vocals = "vocals"          # 只保留人声
    other = "other"            # 只保留 other 轨（吉他/键盘等）


class Note(BaseModel):
    midi: int
    name: str
    start: float = Field(..., description="起始时间（秒）")
    end: float = Field(..., description="结束时间（秒）")
    velocity: float = Field(0.8, ge=0.0, le=1.0)
    string: int = Field(..., description="弦号 0=最低音E ... 5=最高音e")
    fret: int = Field(..., ge=0)


class Chord(BaseModel):
    name: str
    start: float
    end: float


class TranscriptionResult(BaseModel):
    engine: Engine
    degree: Degree
    quantize: Quantize
    separate: Separate
    tempo: float
    duration: float
    sample_rate: int
    tuning: List[str]
    notes: List[Note]
    chords: List[Chord]
    measures: int
    ascii_tab: str
    staff_musicxml: str = Field("", description="MusicXML 4.0 单声部五线谱")
    tab_musicxml: str = Field("", description="MusicXML 4.0 纯 TAB 六线谱")
    dual_musicxml: str = Field("", description="MusicXML 4.0 双谱表（五线谱 + TAB）")
    warnings: List[str] = []
    filename: Optional[str] = None
    processed_audio_base64: Optional[str] = Field(
        None, description="Demucs 分离后的 WAV（base64），仅 separate≠none 且成功时返回"
    )
