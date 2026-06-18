"""FastAPI 入口：上传音频 -> 转写 -> 吉他六线谱。"""
from __future__ import annotations

import base64
import os
import tempfile
import traceback

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import tab, transcribe
from . import separate as demucs_separate
from . import staff
from .models import Degree, Engine, Quantize, Separate, TranscriptionResult
from .tab import TUNING_NAMES


def _advanced_available() -> bool:
    try:
        import basic_pitch  # noqa: F401

        return True
    except Exception:
        return False


def _separate_available() -> bool:
    return demucs_separate.separate_available()

app = FastAPI(title="song-to-tab", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".wma"}
MAX_BYTES = 30 * 1024 * 1024  # 30 MB


@app.get("/")
def root():
    return {
        "name": "song-to-tab",
        "engines": [e.value for e in Engine],
        "degrees": [d.value for d in Degree],
        "quantize": [q.value for q in Quantize],
        "separate": [s.value for s in Separate],
        "advanced_available": _advanced_available(),
        "separate_available": _separate_available(),
    }


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_endpoint(
    file: UploadFile = File(...),
    engine: Engine = Form(Engine.realistic),
    degree: Degree = Form(Degree.simple),
    quantize: Quantize = Form(Quantize.none),
    separate: Separate = Form(Separate.none),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"不支持的文件类型: {ext or '未知'}")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "文件过大（上限 30MB）")
    if not data:
        raise HTTPException(400, "空文件")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        result = transcribe.transcribe(
            tmp_path,
            engine=engine.value,
            degree=degree.value,
            quantize=quantize.value,
            separate_mode=separate.value,
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

        processed_b64 = None
        if result.processed_audio:
            processed_b64 = base64.b64encode(result.processed_audio).decode("ascii")

        return TranscriptionResult(
            engine=engine,
            degree=degree,
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
            staff_musicxml=staff_musicxml,
            tab_musicxml=tab_musicxml,
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
