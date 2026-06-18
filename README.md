# 听歌扒谱 · song-to-tab

上传一段音频，自动识别音符并生成 **吉他六线谱（TAB）** 与 **五线谱**。支持选择扒谱引擎与扒谱程度。

![status](https://img.shields.io/badge/status-MVP-blue)

## ✨ 功能

- 🎵 **上传音频**（mp3 / wav / m4a / flac / ogg）并自动转写
- 🎸 **吉他六线谱**输出（标准调弦 EADGBE，ASCII TAB + 可视化）
- 🎼 **五线谱**输出（MusicXML，可导出 PNG / `.musicxml`，可导入 MuseScore、Finale 等）
- ⚙️ **两种扒谱引擎**
  - **务实 (realistic)** — 基于 `librosa pYIN` 的单声部旋律识别，无重型依赖，稳定可用
  - **进阶 (advanced)** — 基于 Spotify `basic-pitch` 的多声部识别（可选安装）
- 🎚️ **四档扒谱程度**：`simple` 只扒主旋律 / `chords` 只扒和弦 / `medium` 旋律+和弦 / `full` 尽可能多的音符
- 🎼 **四档和弦复杂度**（含和弦时可选）：`rich` 七和弦+sus 等 / `standard` 三和弦 / `simple` 每小节一个 / `minimal` 仅根音、每 2 小节一个
- 🥁 **节奏量化**：可对齐到 1/4、1/8、1/16 拍
- 🎤 **Demucs 人声分离**（可选安装）：转写前可去人声、只保留人声或只保留 other 轨

## 🧱 架构

```
song-to-tab/
├── backend/            FastAPI + librosa 转写引擎
│   ├── app/
│   │   ├── main.py         API 入口（/transcribe）
│   │   ├── transcribe.py   音频 → 音符（旋律/和弦/多声部）
│   │   ├── separate.py     Demucs 音源分离（可选）
│   │   ├── tab.py          音符 → 吉他六线谱 + ASCII TAB
│   │   ├── staff.py        音符 → MusicXML 五线谱
│   │   └── models.py       请求/响应数据结构
│   ├── Dockerfile          后端镜像（见「Docker 一键部署」）
│   └── requirements.txt
├── frontend/           Vite + React + TS 前端
│   ├── Dockerfile          前端构建 + Nginx
│   ├── nginx.conf          生产环境 /api 反代
│   └── src/
├── docker-compose.yml  Docker Compose（基础版 + full profile）
└── .env.example        对外端口配置模板（HOST_PORT）
```

## 🚀 快速开始

### 1. 后端

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
# 可选：开启进阶（多声部）引擎
pip install "basic-pitch[onnx]"
# 可选：Demucs 人声分离（见下方「Demucs 安装与排错」，顺序很重要）
# Windows 推荐：.\dev.ps1 -InstallDemucs

uvicorn app.main:app --reload --port 8000
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 ，上传音频即可。

Windows 一键开发（含 Demucs 可选安装）：

```powershell
.\dev.ps1                 # 启动前后端
.\dev.ps1 -Install        # 安装基础后端依赖
.\dev.ps1 -InstallDemucs  # 安装 Demucs + 兼容版 PyTorch，并自检
```

## 🐳 Docker 一键部署

无需本地安装 Python / Node，用 Docker 在宿主机上启动前后端。对外只暴露**一个端口**（默认 `60901`），Nginx 托管前端并将 `/api` 反代到内部 FastAPI。

### 版本选择

| 命令 | 包含功能 | 镜像体积 | 适用场景 |
|------|----------|----------|----------|
| `docker compose up` | 务实引擎（librosa） | 较小 | 日常扒谱、旋律识别 |
| `docker compose --profile full up` | + Demucs 人声分离 + basic-pitch 进阶引擎 | 约 2GB+ | 需要分离人声或进阶多声部识别 |

### 第一步：安装 Docker

- **Windows / macOS**：安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Linux**：安装 [Docker Engine](https://docs.docker.com/engine/install/) 与 [Compose 插件](https://docs.docker.com/compose/install/)

安装后确认命令可用：

```bash
docker --version
docker compose version
```

### 第二步：获取代码

```bash
git clone <你的仓库地址> song-to-tab
cd song-to-tab
```

若已在本地有代码，直接进入项目根目录（包含 `docker-compose.yml` 的目录）即可。

### 第三步：配置端口（可选）

默认访问地址为 **http://localhost:60901**。若要修改对外端口：

```bash
# Linux / macOS
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

编辑 `.env`：

```dotenv
HOST_PORT=60901
```

改端口后，若容器已在运行，需先停止再启动（见下方「停止服务」）。

也可**不创建 `.env`**，启动时临时指定：

```bash
# Linux / macOS
HOST_PORT=9000 docker compose up -d --build

# Windows PowerShell
$env:HOST_PORT=9000; docker compose up -d --build
```

### 第四步：构建并启动

在项目根目录执行：

```bash
# 基础版（推荐首次尝试）
docker compose up -d --build

# 完整版（首次构建较慢，需下载 PyTorch 等大依赖）
docker compose --profile full up -d --build
```

说明：

- `-d`：后台运行
- `--build`：构建镜像（代码或 Dockerfile 变更后需带上）
- 首次构建需拉取基础镜像并安装依赖，请耐心等待
- 完整版首次使用 Demucs 分离时，还会下载 `htdemucs` 模型（数百 MB），已缓存到 `model-cache` 卷

查看构建/启动进度：

```bash
docker compose ps
docker compose logs -f
# 完整版查看后端日志：
docker compose --profile full logs -f backend-full
```

### 第五步：验证服务

**1. 健康检查**

```bash
# 将 60901 换成你的 HOST_PORT
curl http://localhost:60901/api/health
```

应返回：`{"ok":true}`

**2. 查看后端能力**

```bash
curl http://localhost:60901/api/
```

返回 JSON 中：

- 基础版：`advanced_available: false`，`separate_available: false`
- 完整版：两者均为 `true`

**3. 打开页面**

浏览器访问 **http://localhost:60901**（或你配置的端口），上传一段音频测试扒谱。

### 第六步：日常使用

| 操作 | 命令 |
|------|------|
| 查看运行状态 | `docker compose ps` |
| 查看日志 | `docker compose logs -f` |
| 只看后端日志 | `docker compose logs -f backend` |
| 代码更新后重建 | `docker compose up -d --build` |
| 停止服务 | `docker compose down` |
| 停止完整版 | `docker compose --profile full down` |
| 停止并删除模型缓存 | `docker compose down -v` |

修改 `.env` 中的 `HOST_PORT` 后：

```bash
docker compose down
docker compose up -d
```

### 架构说明

```
浏览器 → 宿主机:HOST_PORT → frontend (Nginx)
                              ├─ /        → 静态页面 (React)
                              └─ /api/*   → backend:8000 (FastAPI，仅容器内网)
```

- 后端 **8000 端口不对外暴露**，只能通过 Nginx 的 `/api` 访问
- 前端代码中 `API_BASE = "/api"` 无需修改
- 完整版中 `backend-full` 在 Docker 网络内别名仍为 `backend`，Nginx 配置通用

### 常见问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `port is already allocated` | `HOST_PORT` 被占用 | 修改 `.env` 中的 `HOST_PORT`，或关闭占用该端口的程序 |
| 页面能开但上传失败 | 后端未就绪或构建失败 | `docker compose logs backend` 查看报错 |
| 完整版无 Demucs / 进阶引擎 | 用了基础版命令启动 | 改用 `docker compose --profile full up -d --build` |
| 首次分离很慢 | Demucs 下载模型 + CPU 推理 | 正常现象，后续会使用 `model-cache` 卷中的缓存 |
| 改代码后页面无变化 | 未重建镜像 | `docker compose up -d --build` |
| Windows 下 `cp` 报错 | PowerShell 无 `cp` | 使用 `Copy-Item .env.example .env` |

### 限制

- 完整版镜像约 **2GB+**，首次 `docker compose build` 需数分钟
- CPU 推理，Demucs 分离耗时与本地非 GPU 环境相当
- 适合内网/自用；公网部署请自行在前方加 HTTPS 反代（Caddy / Traefik 等）

## Demucs 安装与排错

Demucs 是**可选**功能：不装也能正常扒谱；只有需要从混音里去掉人声/提取某一声部时才需要。

### 推荐安装顺序

**先装 PyTorch，再装 demucs。** 若直接 `pip install demucs`，pip 可能拉取较新的 torch（如 2.12），在部分 Windows 上会出现 `c10.dll` 加载失败。

```bash
cd backend
.venv\Scripts\activate   # 或 source .venv/bin/activate

# 1. 固定 CPU 版 PyTorch（Windows 上已验证 2.4.1 稳定）
pip install torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cpu

# 2. 再装 demucs
pip install demucs

# 3. 自检（应输出 separate_available: True）
python -c "from app.separate import separate_available, separate_unavailable_reason as r; print(separate_available(), r())"
```

### 我们踩过的坑

| 现象 | 原因 | 解决 |
|------|------|------|
| ⚠ 未检测到 demucs，已跳过人声分离 | 早期代码用了不存在的 `demucs.api`（demucs 4.x 无此模块） | 已改为 `get_model` + `apply_model` 等 4.x API |
| 前端显示 Demucs「可用」，扒谱仍跳过 | 可用性只检查了 `import demucs`，未验证 torch 能否加载 | 现统一用 `separate_available()`，同时检测 torch |
| `c10.dll` / WinError 1114 | `pip install demucs` 自动装了 torch 2.12，与 torchaudio 版本不匹配，Windows DLL 初始化失败 | 先装 torch 2.4.1+cpu，再装 demucs |
| 装了依赖仍不生效 | `dev.ps1` 发现 8000 端口占用会**跳过**启动新后端，旧进程仍用旧环境 | 关闭 `song-to-tab backend` 窗口后重新 `.\dev.ps1` |
| 在项目根目录 `pip install demucs` | 装到了系统 Python，而非 `backend/.venv` | 必须在 `backend/.venv` 内安装，或用 `.\dev.ps1 -InstallDemucs` |

### 在其他电脑上如何避免

1. **始终使用 venv**：`backend/.venv`，不要全局 `pip install`。
2. **按顺序安装**：torch（固定版本）→ demucs → 运行上面的自检命令。
3. **改依赖后重启后端**：关闭旧 backend 窗口，再运行 `.\dev.ps1`。
4. **看具体 warning**：若分离失败，界面会显示 PyTorch / ffmpeg 等具体原因，而不是笼统的「未检测到 demucs」。
5. **首次分离较慢**：会下载 `htdemucs` 模型（数百 MB）；mp3 等格式可能需要系统安装 [ffmpeg](https://ffmpeg.org/)。

## 📝 说明与限制

- 全曲多乐器分离非常困难。**单声部 / 主旋律识别最可靠**。
- `务实` 引擎对清晰的主旋律（人声哼唱、独奏、单音solo）效果最佳。
- `进阶` 引擎需要额外安装 `basic-pitch`，对和弦/复音有更好表现，但结果不保证。
- **和弦复杂度**：chroma 模板对七和弦 / sus 的区分能力有限，「丰富」档为尽力识别；「标准」档最稳定。「简易 / 极简」通过合并降低密度，适合弹唱草稿。
- **Demucs 分离**为可选功能，安装与排错见上文「Demucs 安装与排错」。首次运行会下载模型，CPU 下分离较慢。
- 生成的谱子是**辅助草稿**，建议人工校对。
