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
│   └── requirements.txt
└── frontend/           Vite + React + TS 前端
    └── src/
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
