#!/usr/bin/env bash
# 停止开发服务：后端 (8000) + 前端 (5173)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT=8000
FRONTEND_PORTS=(5173 5174)

BACKEND_ONLY=false
FRONTEND_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --backend-only) BACKEND_ONLY=true ;;
    --frontend-only) FRONTEND_ONLY=true ;;
    -h|--help)
      echo "用法: ./stop-dev.sh [--backend-only] [--frontend-only]"
      exit 0
      ;;
  esac
done

declare -A KILLED=()
STOPPED=0

kill_pid() {
  local pid="$1"
  local label="$2"
  [[ -z "$pid" || "$pid" == "0" ]] && return
  [[ -n "${KILLED[$pid]:-}" ]] && return
  if kill -0 "$pid" 2>/dev/null; then
    echo "[停止] $label -> pid $pid"
    kill -TERM "$pid" 2>/dev/null || true
    sleep 0.2
    kill -KILL "$pid" 2>/dev/null || true
    KILLED[$pid]=1
    STOPPED=$((STOPPED + 1))
  fi
}

kill_port() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -i ":$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  for pid in $pids; do
    kill_pid "$pid" "$label (port $port)"
  done
}

kill_project_pattern() {
  local pattern="$1"
  local label="$2"
  local pids
  pids="$(pgrep -f "song-to-tab.*$pattern" 2>/dev/null || true)"
  for pid in $pids; do
    kill_pid "$pid" "$label"
  done
}

port_in_use() {
  lsof -i ":$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

echo ""
echo "song-to-tab 停止"
echo ""

if [[ "$FRONTEND_ONLY" != true ]]; then
  kill_port "$BACKEND_PORT" "backend"
  kill_project_pattern 'uvicorn|app\.main' "backend"
fi

if [[ "$BACKEND_ONLY" != true ]]; then
  for port in "${FRONTEND_PORTS[@]}"; do
    kill_port "$port" "frontend"
  done
  kill_project_pattern 'vite|npm run dev' "frontend"
fi

if [[ "$STOPPED" -eq 0 ]]; then
  echo "没有需要停止的进程（端口空闲且无匹配进程）。"
else
  echo ""
  echo "已停止 $STOPPED 个进程。"
fi

echo ""
if [[ "$FRONTEND_ONLY" != true ]] && port_in_use "$BACKEND_PORT"; then
  echo "[警告] 后端端口 $BACKEND_PORT 仍被占用"
fi
if [[ "$BACKEND_ONLY" != true ]] && port_in_use 5173; then
  echo "[警告] 前端端口 5173 仍被占用"
fi
if [[ "$BACKEND_ONLY" != true ]] && port_in_use 5174; then
  echo "[警告] 前端端口 5174 仍被占用"
fi
echo ""
