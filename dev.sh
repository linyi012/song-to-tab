#!/usr/bin/env bash
# 开发环境一键启动：后端 (8000) + 前端 (5173)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
UVICORN="$BACKEND_DIR/.venv/bin/uvicorn"
BACKEND_PORT=8000
FRONTEND_PORT=5173

INSTALL=false
BACKEND_ONLY=false
FRONTEND_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=true ;;
    --backend-only) BACKEND_ONLY=true ;;
    --frontend-only) FRONTEND_ONLY=true ;;
    -h|--help)
      echo "用法: ./dev.sh [--install] [--backend-only] [--frontend-only]"
      exit 0
      ;;
  esac
done

port_in_use() {
  lsof -i ":$1" -sTCP:LISTEN -t >/dev/null 2>&1
}

echo ""
echo "song-to-tab 开发启动"
echo ""

if [[ "$FRONTEND_ONLY" != true ]]; then
  if [[ ! -x "$UVICORN" ]]; then
    echo "[错误] 未找到后端虚拟环境: backend/.venv"
    echo "请先执行:"
    echo "  cd backend"
    echo "  python -m venv .venv"
    echo "  source .venv/bin/activate"
    echo "  pip install -r requirements.txt"
    exit 1
  fi

  if [[ "$INSTALL" == true ]]; then
    echo "[安装] 后端依赖..."
    "$BACKEND_DIR/.venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
  fi

  if port_in_use "$BACKEND_PORT"; then
    echo "[跳过] 后端端口 $BACKEND_PORT 已被占用，可能已在运行"
    echo "       http://127.0.0.1:$BACKEND_PORT/docs"
  else
    echo "[启动] 后端 -> http://127.0.0.1:$BACKEND_PORT"
    (
      cd "$BACKEND_DIR"
      exec "$UVICORN" app.main:app --reload --port "$BACKEND_PORT"
    ) &
  fi
fi

if [[ "$BACKEND_ONLY" != true ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "[错误] 未找到 npm，请先安装 Node.js"
    exit 1
  fi

  if [[ ! -d "$FRONTEND_DIR/node_modules" || "$INSTALL" == true ]]; then
    echo "[安装] 前端依赖..."
    (cd "$FRONTEND_DIR" && npm install)
  fi

  if port_in_use "$FRONTEND_PORT"; then
    echo "[跳过] 前端端口 $FRONTEND_PORT 已被占用，可能已在运行"
    echo "       http://localhost:$FRONTEND_PORT"
  else
    echo "[启动] 前端 -> http://localhost:$FRONTEND_PORT"
    (cd "$FRONTEND_DIR" && npm run dev) &
  fi
fi

echo ""
echo "服务已在后台运行，Ctrl+C 可停止本脚本（macOS/Linux 子进程可能仍在运行）。"
echo "打开 http://localhost:$FRONTEND_PORT"
echo ""

wait
