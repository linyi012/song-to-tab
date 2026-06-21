"""子进程隔离重任务，避免 OOM 拖死 uvicorn 主进程。"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any, Dict, Optional

# Linux OOM killer often exits with 128 + signal(9)
_OOM_EXIT = 137

_WORKER_MODULES = {
    "probe_separate": "app.workers.probe_separate",
    "probe_advanced": "app.workers.probe_advanced",
    "separate_worker": "app.workers.separate_worker",
    "polyphonic_worker": "app.workers.polyphonic_worker",
}


def should_isolate() -> bool:
    val = os.environ.get("SONG_TO_TAB_ISOLATE_HEAVY", "true").lower()
    return val not in ("0", "false", "no")


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def _oom_message() -> str:
    return "内存不足，任务被系统终止"


def run_worker(
    worker: str,
    payload: Dict[str, Any],
    timeout: Optional[int] = None,
) -> Dict[str, Any]:
    """在子进程中运行 worker，返回解析后的 JSON dict。"""
    module = _WORKER_MODULES.get(worker)
    if module is None:
        return {"ok": False, "error": f"未知 worker: {worker}"}

    try:
        proc = subprocess.run(
            [sys.executable, "-m", module],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        limit = timeout if timeout is not None else "?"
        return {"ok": False, "error": f"任务超时（超过 {limit} 秒）"}

    if proc.returncode == _OOM_EXIT:
        return {"ok": False, "error": _oom_message()}

    stdout = (proc.stdout or "").strip()
    if stdout:
        for line in reversed(stdout.splitlines()):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if isinstance(data, dict):
                    if proc.returncode != 0 and not data.get("error"):
                        data["error"] = proc.stderr or f"worker 退出码 {proc.returncode}"
                        data["ok"] = False
                    return data
            except json.JSONDecodeError:
                continue

    if proc.returncode != 0:
        err = (proc.stderr or "").strip() or f"worker 退出码 {proc.returncode}"
        if proc.returncode == _OOM_EXIT:
            err = _oom_message()
        return {"ok": False, "error": err}

    return {"ok": False, "error": "worker 无有效输出"}
