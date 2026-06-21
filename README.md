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
| `docker compose --env-file .env.example up` | 务实引擎（librosa） | 较小 | 日常扒谱、旋律识别 |
| `docker compose --env-file .env.full.example up` | + Demucs 人声分离 + basic-pitch 进阶引擎 | 约 2GB+ | 需要分离人声或进阶多声部识别 |

基础版与完整版通过 **Compose profile 互斥**：同一时刻只会启动 `backend` + `frontend` 两个容器，不会同时占用端口。差异在后端镜像（是否安装 Demucs / basic-pitch）与运行参数；**前端为同一套 React 构建产物**，启动后通过 `/api/capabilities/*` 探测后端能力并自适应 UI。

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

### 第三步：配置环境

项目提供两份示例配置，**所有平台命令相同**（无需区分 bash / PowerShell）：

| 文件 | 用途 |
|------|------|
| [`.env.example`](.env.example) | 基础版（`COMPOSE_PROFILES=basic`，`INSTALL_OPTIONAL=false`） |
| [`.env.full.example`](.env.full.example) | 完整版（`COMPOSE_PROFILES=full`，`INSTALL_OPTIONAL=true`） |

可复制为 `.env` 后编辑端口，也可启动时直接用 `--env-file` 引用示例文件（见第四步）。

默认访问地址为 **http://localhost:60901**。若要修改对外端口，编辑对应文件中的 `HOST_PORT`。

改端口后，若容器已在运行，需先停止再启动（见下方「停止服务」）。

### 第四步：构建并启动

在项目根目录执行（**Windows / macOS / Linux 相同**）：

```bash
# 基础版（推荐首次尝试）
docker compose --env-file .env.example up -d --build

# 完整版（Demucs + basic-pitch；首次构建较慢）
docker compose --env-file .env.full.example up -d --build
```

若已复制 `.env.example` 为 `.env` 并改过配置，基础版也可简写为：

```bash
docker compose up -d --build
```

说明：通过 `--env-file` 指定 `COMPOSE_PROFILES` 及后端构建参数，基础版与完整版**不会同时启动**，避免端口冲突。切换 profile 时因 `INSTALL_OPTIONAL` 不同会重建 backend 镜像，属预期行为；请先 `down` 再换 env 文件后 `up --build`。

说明：

- `-d`：后台运行
- `--build`：构建镜像（代码或 Dockerfile 变更后需带上）
- 首次构建需拉取基础镜像并安装依赖，请耐心等待
- 完整版首次使用 Demucs 分离时，还会下载 `htdemucs` 模型（数百 MB），已缓存到 `model-cache` 卷

查看构建/启动进度：

```bash
docker compose --env-file .env.example ps
docker compose --env-file .env.example logs -f

# 完整版查看后端日志：
docker compose --env-file .env.full.example logs -f backend
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

完整版额外确认：应只有 2 个容器在运行（`frontend`、`backend`）：

```bash
docker compose --env-file .env.full.example ps
curl -s http://localhost:60901/api/
```

返回 JSON 中 `advanced_available` 与 `separate_available` 均应为 `true`。

### 第六步：日常使用

| 操作 | 命令 |
|------|------|
| 查看运行状态 | `docker compose --env-file .env.example ps`（或 `.env.full.example`） |
| 查看日志 | `docker compose --env-file .env.example logs -f` |
| 只看后端日志 | `docker compose --env-file .env.example logs -f backend` |
| 代码更新后重建 | `docker compose --env-file .env.example up -d --build` |
| 停止基础版 | `docker compose --env-file .env.example down` |
| 停止完整版 | `docker compose --env-file .env.full.example down` |
| 停止并删除模型缓存 | 在上述 `down` 命令后加 `-v` |

修改端口后，先 `down` 再 `up`：

```bash
docker compose --env-file .env.example down
docker compose --env-file .env.example up -d
```

### 架构说明

基础版与完整版共用同一对服务名（`frontend` + `backend`），仅后端镜像与运行参数不同：

```
浏览器 → 宿主机:HOST_PORT → frontend (Nginx)
                              ├─ /        → 静态页面 (React，同一构建)
                              └─ /api/*   → backend:8000 (FastAPI，仅容器内网)
```

| profile | 后端差异 |
|---------|----------|
| `basic` | 仅 librosa 务实引擎（`INSTALL_OPTIONAL=false`） |
| `full` | + torch / Demucs / basic-pitch（`INSTALL_OPTIONAL=true`，`privileged` + 更大 `shm_size`） |

- 后端 **8000 端口不对外暴露**，只能通过 Nginx 的 `/api` 访问
- 前端代码中 `API_BASE = "/api"` 无需修改；**前端无 basic/full 两套 UI**，Demucs / 进阶引擎是否可用由运行时 API 探测决定
- 完整版 backend 使用 `privileged: true` 与 `shm_size: 2gb`（见 `.env.full.example`），便于 PyTorch/Demucs 在容器内运行

### 常见问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `port is already allocated` | `HOST_PORT` 被占用，或基础版与完整版容器同时运行 | 修改 env 文件中的 `HOST_PORT`；`docker compose ps` 确认只有 `frontend` + `backend`；切换版本时先 `down` 再换 `--env-file` |
| 页面能开但上传失败 | 后端未就绪或构建失败 | `docker compose --env-file .env.example logs backend`（或 `.env.full.example`） |
| 完整版无 Demucs / 进阶引擎 | 用了基础版 env，或 optional 依赖未装上 | 确认使用 `--env-file .env.full.example`；`curl http://localhost:60901/api/` 中两项应为 `true` |
| 首次分离很慢 | Demucs 下载模型 + CPU 推理 | 正常现象，后续会使用 `model-cache` 卷中的缓存 |
| 分离超时报错 | Demucs 子进程 / Nginx / 前端 fetch 任一环节过短 | 默认均为 3600s；NAS 上重建：`up -d --build` |
| 改代码后页面无变化 | 未重建镜像 | 对应用 `--env-file` 执行 `up -d --build` |
| Windows 下 `cp` 报错 | PowerShell 无 `cp` | 使用 `Copy-Item .env.example .env`（仅复制配置时需要） |

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

## NAS / 低内存部署

完整版（PyTorch + Demucs + basic-pitch）在 **NAS 或内存较小的机器** 上可能因 `import basic_pitch` 导致 `GET /` 崩溃。当前版本已做如下优化：

### 能力检测（独立 API）

Demucs 与 basic-pitch **分开探测**，互不影响：

| 端点 | 说明 |
|------|------|
| `GET /capabilities/separate` | Demucs / PyTorch 是否可用 |
| `GET /capabilities/advanced` | basic-pitch 是否可加载 |
| `GET /` | 聚合上述两项（向后兼容） |

前端分别请求两个端点，一侧失败不会导致另一侧显示错误。

### 分离与扒谱分流

| 端点 | 用途 |
|------|------|
| `POST /separate` | **仅做人声分离**，返回 WAV（base64），不扒谱 |
| `POST /transcribe` | 扒谱；`separate≠none` 时为**分离并扒谱** |

前端提供三个操作：**开始分离**、**分离并扒谱**、**开始扒谱**（可对已分离音频扒谱，避免重复跑 Demucs）。

### 子进程隔离

Demucs 分离、basic-pitch 进阶扒谱、能力探测默认在**子进程**中执行。子进程因 OOM 被 Kill 时，uvicorn 主进程通常仍可继续服务。

### 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `SONG_TO_TAB_ISOLATE_HEAVY` | `true` | `false` 时重任务回到进程内（调试用） |
| `SONG_TO_TAB_CAPABILITY_CACHE_TTL` | `300` | 能力检测缓存秒数 |
| `SONG_TO_TAB_WORKER_TIMEOUT_SEPARATE` | `3600` | Demucs 分离超时（秒） |
| `SONG_TO_TAB_WORKER_TIMEOUT_POLYPHONIC` | `300` | basic-pitch 超时 |
| `SONG_TO_TAB_WORKER_TIMEOUT_PROBE` | `120` | 能力探测超时 |

### NAS 建议

1. 为系统或 Docker 配置 **2–4GB swap**，减轻 OOM。
2. 优先使用 **务实引擎**；进阶引擎在极低内存下可能探测为不可用。
3. 需要分离时，可先 **仅分离** 试听确认，再 **对分离结果扒谱**，降低单次内存峰值。

## 📝 说明与限制

- 全曲多乐器分离非常困难。**单声部 / 主旋律识别最可靠**。
- `务实` 引擎对清晰的主旋律（人声哼唱、独奏、单音solo）效果最佳。
- `进阶` 引擎需要额外安装 `basic-pitch`，对和弦/复音有更好表现，但结果不保证。
- **和弦复杂度**：chroma 模板对七和弦 / sus 的区分能力有限，「丰富」档为尽力识别；「标准」档最稳定。「简易 / 极简」通过合并降低密度，适合弹唱草稿。
- **Demucs 分离**为可选功能，安装与排错见上文「Demucs 安装与排错」。首次运行会下载模型，CPU 下分离较慢。
- 生成的谱子是**辅助草稿**，建议人工校对。
