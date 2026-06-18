"""Demucs 音源分离预处理（可选安装）。"""
from __future__ import annotations

import os
import tempfile
from typing import Optional, Tuple


def _import_error() -> Optional[str]:
    """Return None if demucs separation deps load; else a short reason."""
    try:
        import demucs  # noqa: F401
    except Exception as exc:
        return f"未安装 demucs（{exc}）"

    try:
        import torch  # noqa: F401
        from demucs.apply import apply_model  # noqa: F401
        from demucs.pretrained import get_model  # noqa: F401
        from demucs.separate import load_track  # noqa: F401
    except Exception as exc:
        return (
            f"PyTorch 加载失败（{exc}）。"
            "请安装 CPU 版：pip install torch==2.4.1 torchaudio==2.4.1 "
            "--index-url https://download.pytorch.org/whl/cpu"
        )
    return None


def separate_available() -> bool:
    return _import_error() is None


def separate_unavailable_reason() -> Optional[str]:
    err = _import_error()
    if err is None:
        return None
    return f"人声分离不可用：{err}"


def run_separation(path: str, mode: str) -> Tuple[Optional[str], Optional[str]]:
    """分离音频并导出目标声部 wav。

    Returns:
        (out_path, warning) — 成功时 warning 为 None；失败时 out_path 为 None。
    """
    if mode == "none":
        return path, None

    reason = _import_error()
    if reason:
        return None, f"{reason}，已跳过人声分离。"

    try:
        import torch as th
        from demucs.apply import apply_model
        from demucs.audio import save_audio
        from demucs.pretrained import get_model
        from demucs.separate import load_track
    except Exception as exc:
        return None, f"人声分离依赖加载失败，已跳过人声分离：{exc}"

    out_path: Optional[str] = None
    try:
        model = get_model("htdemucs")
        device = "cuda" if th.cuda.is_available() else "cpu"
        model.to(device)
        model.eval()

        wav = load_track(path, model.audio_channels, model.samplerate)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / ref.std()
        sources = apply_model(
            model,
            wav[None],
            device=device,
            shifts=1,
            split=True,
            overlap=0.25,
            progress=False,
        )[0]
        sources = sources * ref.std() + ref.mean()

        stems = {name: sources[i] for i, name in enumerate(model.sources)}

        if mode == "no_vocals":
            tensor = th.zeros_like(next(iter(stems.values())))
            for name, stem in stems.items():
                if name != "vocals":
                    tensor += stem
        elif mode in ("vocals", "other"):
            if mode not in stems:
                return None, f"分离结果中缺少 {mode} 声部，已回退到原始音频。"
            tensor = stems[mode]
        else:
            return None, f"未知的分离模式: {mode}，已回退到原始音频。"

        fd, out_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        save_audio(tensor, out_path, samplerate=model.samplerate)
        return out_path, None
    except Exception as exc:
        if out_path and os.path.exists(out_path):
            try:
                os.remove(out_path)
            except OSError:
                pass
        return None, f"Demucs 分离失败，已回退到原始音频: {exc}"
