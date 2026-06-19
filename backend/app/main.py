"""FastAPI 入口：上传音频 -> 转写 -> 吉他六线谱。"""
from __future__ import annotations

import asyncio
import base64
import os
import tempfile
import traceback

import librosa
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import capabilities, separate as demucs_separate, tab, transcribe, staff
from .models import (
    ChordComplexity,
    Degree,
    Engine,
    Quantize,
    Separate,
    SeparationResult,
    TranscriptionResult,
)
from .tab import TUNING_NAMES

app = FastAPI(title="song-to-tab", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".wma"}
MAX_BYTES = 30 * 1024 * 1024  # 30 MB


def _validate_upload(ext: str, data: bytes) -> None:
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"不支持的文件类型: {ext or '未知'}")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "文件过大（上限 30MB）")
    if not data:
        raise HTTPException(400, "空文件")


@app.get("/capabilities/separate")
def capabilities_separate():
    return {
        "available": capabilities.separate_available(),
        "reason": capabilities.separate_unavailable_reason(),
    }


@app.get("/capabilities/advanced")
def capabilities_advanced():
    return {
        "available": capabilities.advanced_available(),
        "reason": capabilities.advanced_unavailable_reason(),
    }


@app.get("/")
def root():
    return {
        "name": "song-to-tab",
        "engines": [e.value for e in Engine],
        "degrees": [d.value for d in Degree],
        "chord_complexities": [c.value for c in ChordComplexity],
        "quantize": [q.value for q in Quantize],
        "separate": [s.value for s in Separate],
        "advanced_available": capabilities.advanced_available(),
        "separate_available": capabilities.separate_available(),
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/separate", response_model=SeparationResult)
async def separate_endpoint(
    file: UploadFile = File(...),
    separate: Separate = Form(...),
):
    if separate == Separate.none:
        raise HTTPException(400, "请选择分离模式（不能为 none）")

    if not capabilities.separate_available():
        reason = capabilities.separate_unavailable_reason() or "人声分离不可用"
        raise HTTPException(422, reason)

    ext = os.path.splitext(file.filename or "")[1].lower()
    data = await file.read()
    _validate_upload(ext, data)

    tmp_path = None
    separated_path = None
    warnings: list[str] = []
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        separated_path, sep_warn = await asyncio.to_thread(
            demucs_separate.run_separation,
            tmp_path,
            separate.value,
        )
        if sep_warn:
            warnings.append(sep_warn)
            raise HTTPException(422, sep_warn)

        if not separated_path or not os.path.exists(separated_path):
            raise HTTPException(500, "分离失败：未生成输出文件")

        duration = float(librosa.get_duration(path=separated_path))
        with open(separated_path, "rb") as f:
            processed_b64 = base64.b64encode(f.read()).decode("ascii")

        return SeparationResult(
            separate=separate,
            duration=round(duration, 2),
            warnings=warnings,
            filename=file.filename,
            processed_audio_base64=processed_b64,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(500, f"分离失败: {exc}") from exc
    finally:
        for p in (tmp_path, separated_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_endpoint(
    file: UploadFile = File(...),
    engine: Engine = Form(Engine.realistic),
    degree: Degree = Form(Degree.simple),
    chord_complexity: ChordComplexity = Form(ChordComplexity.standard),
    quantize: Quantize = Form(Quantize.none),
    separate: Separate = Form(Separate.none),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    data = await file.read()
    _validate_upload(ext, data)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        result = await asyncio.to_thread(
            transcribe.transcribe,
            tmp_path,
            engine=engine.value,
            degree=degree.value,
            quantize=quantize.value,
            separate_mode=separate.value,
            chord_complexity=chord_complexity.value,
        )

        notes = tab.assign_positions(result.notes)
        chords = tab.chords_to_models(result.chords)
        ascii_tab = tab.render_ascii_tab(notes, result.tempo, chords)
        measures = tab.count_measures(notes, result.tempo, chords)
        title = (file.filename or "Transcription").rsplit(".", 1)[0]
        xml_kw = dict(
            tempo=result.tempo,
            quantize=quantize.value,
            title=title,
            duration=result.duration,
        )
        staff_musicxml = staff.build_staff_musicxml(notes, result.chords, **xml_kw)
        tab_musicxml = staff.build_tab_musicxml(notes, result.chords, **xml_kw)
        dual_musicxml = staff.build_dual_musicxml(notes, result.chords, **xml_kw)
        ascii_tab_chords = (
            tab.render_ascii_tab([], result.tempo, chords) if chords else ""
        )
        tab_musicxml_chords = (
            staff.build_chords_tab_musicxml(result.chords, **xml_kw) if chords else ""
        )

        processed_b64 = None
        if result.processed_audio:
            processed_b64 = base64.b64encode(result.processed_audio).decode("ascii")

        return TranscriptionResult(
            engine=engine,
            degree=degree,
            chord_complexity=chord_complexity,
            quantize=quantize,
            separate=separate,
            tempo=result.tempo,
            duration=round(result.duration, 2),
            sample_rate=result.sample_rate,
            tuning=TUNING_NAMES,
            notes=notes,
            chords=chords,
            measures=measures,
            ascii_tab=ascii_tab,
            ascii_tab_chords=ascii_tab_chords,
            staff_musicxml=staff_musicxml,
            tab_musicxml=tab_musicxml,
            tab_musicxml_chords=tab_musicxml_chords,
            dual_musicxml=dual_musicxml,
            warnings=result.warnings,
            filename=file.filename,
            processed_audio_base64=processed_b64,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(500, f"转写失败: {exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
