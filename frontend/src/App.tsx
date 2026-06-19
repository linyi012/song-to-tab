import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkCapabilities,
  separateAudio,
  separationResultToFile,
  transcribe,
  type CapabilityStatus,
  type ChordComplexity,
  type Degree,
  type Engine,
  type Quantize,
  type Separate,
  type SeparationResult,
  type TranscriptionResult,
} from "./api";
import { useBackendStatus } from "./useBackendStatus";
import { TabPlayer, PLAYBACK_SPEEDS, type PlaybackSpeed, type PreviewMode } from "./player";
import TabView, { type TabViewHandle } from "./TabView";
import StaffView, { type StaffViewHandle } from "./StaffView";
import { downloadMusicXml, downloadText } from "./staffExport";
import SourceAudioPlayer, { base64ToAudioUrl } from "./SourceAudioPlayer";
import { IconPause, IconPlay, IconStop } from "./TransportIcons";
import {
  INSTRUMENT_LABELS,
  type Instrument,
} from "./instruments";

interface Opt<T> {
  id: T;
  title: string;
  desc: string;
}

const ENGINES: Opt<Engine>[] = [
  { id: "realistic", title: "务实", desc: "librosa 单声部旋律识别，稳定可用" },
  { id: "advanced", title: "进阶", desc: "basic-pitch 多声部识别（需安装）" },
];

const DEGREES: Opt<Degree>[] = [
  { id: "simple", title: "简化", desc: "只扒主旋律（单音）" },
  { id: "chords", title: "和弦", desc: "只识别和弦走向（无单音旋律）" },
  { id: "medium", title: "中等", desc: "旋律 + 主要和弦" },
  { id: "full", title: "完整", desc: "尽可能多的音符（进阶引擎更佳）" },
];

const CHORD_COMPLEXITIES: Opt<ChordComplexity>[] = [
  {
    id: "rich",
    title: "丰富",
    desc: "七和弦、sus、增减 + 拍级变化",
  },
  {
    id: "standard",
    title: "标准",
    desc: "大三/小三三和弦 + 拍级变化",
  },
  {
    id: "simple",
    title: "简易",
    desc: "三和弦 + 每小节一个和弦",
  },
  {
    id: "minimal",
    title: "极简",
    desc: "仅根音 + 每 2 小节一个和弦",
  },
];

const QUANTS: Opt<Quantize>[] = [
  { id: "none", title: "不量化", desc: "保留原始时值" },
  { id: "quarter", title: "1/4 拍", desc: "对齐到四分音符" },
  { id: "eighth", title: "1/8 拍", desc: "对齐到八分音符" },
  { id: "sixteenth", title: "1/16 拍", desc: "对齐到十六分音符" },
];

const SEPARATES: Opt<Separate>[] = [
  { id: "none", title: "不分离", desc: "直接使用原始音频" },
  { id: "no_vocals", title: "去人声", desc: "保留 drums/bass/other 伴奏轨" },
  { id: "vocals", title: "只保留人声", desc: "仅提取 vocals 声部" },
  { id: "other", title: "只保留 other", desc: "吉他/键盘等常在此轨" },
];

const INSTRUMENTS: Opt<Instrument>[] = [
  { id: "guitar", title: "🎸 吉他", desc: "标准调弦 EADGBE · 拨弦音色" },
  { id: "ukulele", title: "🪕 尤克里里", desc: "GCEA · 明亮拨弦音色" },
  { id: "piano", title: "🎹 钢琴", desc: "键盘音色（试听旋律）" },
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function defaultPreviewMode(result: TranscriptionResult): PreviewMode {
  const melody = result.notes.length > 0;
  const chords = result.chords.length > 0;
  if (melody && chords) return "both";
  if (chords) return "chords";
  return "melody";
}

function capabilityBadgeLabel(status: CapabilityStatus): string {
  switch (status) {
    case "loading":
      return "检测中";
    case "available":
      return "可用";
    case "unavailable":
      return "未安装";
    case "unreachable":
      return "后端离线";
  }
}

function capabilityBadgeOn(status: CapabilityStatus): boolean {
  return status === "available";
}

interface BusyStageInfo {
  title: string;
  subtitle: string;
}

function getBusyStage(
  separating: boolean,
  loading: boolean,
  separate: Separate,
  engine: Engine
): BusyStageInfo {
  if (separating) {
    return {
      title: "正在做人声分离…",
      subtitle: "Demucs 首次运行需下载模型，可能需要数分钟",
    };
  }
  if (loading && separate !== "none") {
    return {
      title: "分离并扒谱中…",
      subtitle: "会先分离再转写，总耗时较长",
    };
  }
  if (loading && engine === "advanced") {
    return {
      title: "进阶引擎扒谱中…",
      subtitle: "首次加载 basic-pitch 模型较慢",
    };
  }
  return {
    title: "正在扒谱…",
    subtitle: "音频越长耗时越久，属正常现象",
  };
}

function getBusyReassurance(elapsedSec: number): string | null {
  if (elapsedSec < 30) return null;
  if (elapsedSec < 180) return "仍在处理中，后端正常响应，请耐心等待。";
  if (elapsedSec < 600) {
    return "已处理较长时间。Demucs / 长音频可能需 5–15 分钟，可继续等待或点取消。";
  }
  return "已超 10 分钟。若确认音频不长，可取消后检查 NAS 容器内存/日志。";
}

function formatBusyElapsed(elapsedSec: number): string {
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [engine, setEngine] = useState<Engine>("realistic");
  const [degree, setDegree] = useState<Degree>("simple");
  const [chordComplexity, setChordComplexity] =
    useState<ChordComplexity>("standard");
  const [quant, setQuant] = useState<Quantize>("none");
  const [separate, setSeparate] = useState<Separate>("none");
  const [instrument, setInstrument] = useState<Instrument>("guitar");
  const [loading, setLoading] = useState(false);
  const [separating, setSeparating] = useState(false);
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [separationResult, setSeparationResult] =
    useState<SeparationResult | null>(null);
  const [separatedFile, setSeparatedFile] = useState<File | null>(null);
  const [useSeparatedForTranscribe, setUseSeparatedForTranscribe] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOk, setAdvancedOk] = useState<CapabilityStatus>("loading");
  const [separateOk, setSeparateOk] = useState<CapabilityStatus>("loading");
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [busyElapsedSec, setBusyElapsedSec] = useState(0);
  const [view, setView] = useState<"svg" | "staff" | "dual" | "ascii">("svg");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("melody");
  const [audioSource, setAudioSource] = useState<"original" | "separated">(
    "original"
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<TabViewHandle>(null);
  const staffRef = useRef<StaffViewHandle>(null);
  const dualRef = useRef<StaffViewHandle>(null);
  const playerRef = useRef<TabPlayer | null>(null);
  const rafRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  const refreshCapabilities = useCallback(() => {
    checkCapabilities().then((caps) => {
      setAdvancedOk(caps.advanced);
      setSeparateOk(caps.separate);
    });
  }, []);

  useEffect(() => {
    refreshCapabilities();
  }, [refreshCapabilities]);

  const busy = loading || separating;

  const handleBackendAbort = useCallback(() => {
    abortRef.current?.abort(new DOMException("backend", "AbortError"));
    setError("后端服务已断开，操作已中止");
    setLoading(false);
    setSeparating(false);
  }, []);

  const { status: backendStatus, healthOk } = useBackendStatus(
    busy,
    busyStartedAt,
    handleBackendAbort,
    refreshCapabilities
  );

  const backendOffline = backendStatus === "offline";

  useEffect(() => {
    if (!busy) {
      setBusyStartedAt(null);
      setBusyElapsedSec(0);
      return;
    }
    const started = Date.now();
    setBusyStartedAt(started);
    setBusyElapsedSec(0);
    const id = setInterval(() => {
      setBusyElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [busy]);

  const beginAbortableRequest = () => {
    abortRef.current?.abort(new DOMException("superseded", "AbortError"));
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  };

  const cancelBusy = () => {
    abortRef.current?.abort(new DOMException("user", "AbortError"));
  };

  const reportRequestError = (e: unknown) => {
    if (e instanceof DOMException && e.message === "superseded") return;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg) setError(msg);
  };

  useEffect(() => {
    const player = new TabPlayer();
    playerRef.current = player;
    player.onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(player.songDuration);
    };
    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  const originalAudioUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      if (originalAudioUrl) URL.revokeObjectURL(originalAudioUrl);
    };
  }, [originalAudioUrl]);

  const separatedB64 =
    separationResult?.processed_audio_base64 ??
    result?.processed_audio_base64 ??
    null;

  const separatedAudioUrl = useMemo(() => {
    if (!separatedB64) return null;
    return base64ToAudioUrl(separatedB64);
  }, [separatedB64]);

  useEffect(() => {
    return () => {
      if (separatedAudioUrl) URL.revokeObjectURL(separatedAudioUrl);
    };
  }, [separatedAudioUrl]);

  useEffect(() => {
    if (separatedAudioUrl) {
      setAudioSource("separated");
    } else {
      setAudioSource("original");
    }
  }, [separatedAudioUrl]);

  const activeAudioUrl =
    audioSource === "separated" && separatedAudioUrl
      ? separatedAudioUrl
      : originalAudioUrl;

  const separateLabel = useMemo(() => {
    const mode =
      separationResult?.separate ??
      (result && result.separate !== "none" ? result.separate : null);
    if (!mode || mode === "none") return "分离后";
    const opt = SEPARATES.find((s) => s.id === mode);
    return opt ? `分离后 · ${opt.title}` : "分离后";
  }, [separationResult, result]);

  const useSeparatedInput =
    useSeparatedForTranscribe && Boolean(separatedFile);

  const transcribeButtonLabel = useMemo(() => {
    if (loading) {
      return useSeparatedInput
        ? "正在用分离音频扒谱…"
        : "正在用原音频扒谱…";
    }
    return useSeparatedInput ? "用分离音频扒谱" : "用原音频扒谱";
  }, [loading, useSeparatedInput]);

  const busyStage = useMemo(
    () => getBusyStage(separating, loading, separate, engine),
    [separating, loading, separate, engine]
  );

  const busyReassurance = useMemo(
    () => getBusyReassurance(busyElapsedSec),
    [busyElapsedSec]
  );

  const resetPlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    player.unload();
    setCurrentTime(0);
    setIsPlaying(false);
    setPlaybackSpeed(1);
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    setCurrentTime(0);
    setIsPlaying(false);
    setPlaybackSpeed(1);
    if (result && (result.notes.length > 0 || result.chords.length > 0)) {
      const mode = defaultPreviewMode(result);
      setPreviewMode(mode);
      player.load(result.notes, result.chords, result.duration, mode);
      player.setInstrument(instrument);
      player.setPlaybackRate(1);
    } else {
      setPreviewMode("melody");
      player.unload();
    }
  }, [result]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !result) return;
    if (!(result.notes.length > 0 || result.chords.length > 0)) return;

    const wasPlaying = player.isPlaying;
    const t = player.currentTime;
    player.load(result.notes, result.chords, result.duration, previewMode);
    player.setInstrument(instrument);
    if (wasPlaying) {
      void player.play(t);
      setIsPlaying(true);
    }
  }, [instrument, previewMode]);

  const handleSpeedChange = useCallback((speed: PlaybackSpeed) => {
    setPlaybackSpeed(speed);
    playerRef.current?.setPlaybackRate(speed);
  }, []);

  useEffect(() => {
    const tick = () => {
      const player = playerRef.current;
      if (player) {
        if (player.isPlaying) {
          setCurrentTime(player.currentTime);
        }
        setIsPlaying((prev) =>
          prev === player.isPlaying ? prev : player.isPlaying
        );
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const hasMelody = Boolean(result?.notes.length);
  const hasChords = Boolean(result?.chords.length);
  const showChordComplexity =
    degree === "chords" || degree === "medium" || degree === "full";
  const canPreview = hasMelody || hasChords;
  const hasTabContent = Boolean(
    result && (result.notes.length > 0 || result.chords.length > 0)
  );

  const activeNotes = useMemo(() => {
    if (view !== "svg" || !result) return undefined;
    const set = new Set<number>();
    result.notes.forEach((n, i) => {
      if (n.start <= currentTime && currentTime < n.end) set.add(i);
    });
    return set;
  }, [view, result, currentTime]);

  const activeChords = useMemo(() => {
    if (view !== "svg" || !result) return undefined;
    const set = new Set<number>();
    result.chords.forEach((c, i) => {
      if (c.start <= currentTime && currentTime < c.end) set.add(i);
    });
    return set;
  }, [view, result, currentTime]);

  const togglePlay = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !canPreview || !result) return;
    if (player.isPlaying) {
      player.pause();
      setCurrentTime(player.currentTime);
      setIsPlaying(false);
    } else {
      const from =
        currentTime >= result.duration - 0.05 ? 0 : currentTime;
      if (from === 0) setCurrentTime(0);
      setIsPlaying(true);
      await player.play(from);
      setIsPlaying(player.isPlaying);
    }
  }, [canPreview, currentTime, result]);

  const stopPlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    player.stop();
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const seekPlayback = useCallback(
    (sec: number) => {
      if (!result) return;
      const player = playerRef.current;
      if (player && canPreview) {
        player.seek(sec);
        setIsPlaying(player.isPlaying);
      }
      setCurrentTime(sec);
    },
    [canPreview, result]
  );

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    resetPlayback();
    setFile(f);
    setResult(null);
    setSeparationResult(null);
    setSeparatedFile(null);
    setUseSeparatedForTranscribe(false);
    setError(null);
  };

  const runSeparateOnly = async () => {
    if (!file || separate === "none" || backendOffline) return;
    resetPlayback();
    setSeparating(true);
    setError(null);
    setSeparationResult(null);
    setSeparatedFile(null);
    setUseSeparatedForTranscribe(false);
    const signal = beginAbortableRequest();
    try {
      const res = await separateAudio(file, separate, signal);
      setSeparationResult(res);
      const sepFile = separationResultToFile(res, file.name);
      if (sepFile) {
        setSeparatedFile(sepFile);
        setUseSeparatedForTranscribe(true);
      }
    } catch (e) {
      reportRequestError(e);
    } finally {
      setSeparating(false);
      abortRef.current = null;
    }
  };

  const runTranscribeOnly = async () => {
    if (!file || backendOffline) return;
    const input =
      useSeparatedForTranscribe && separatedFile ? separatedFile : file;
    resetPlayback();
    setLoading(true);
    setError(null);
    setResult(null);
    const signal = beginAbortableRequest();
    try {
      const res = await transcribe(
        input,
        {
          engine,
          degree,
          chord_complexity: chordComplexity,
          quantize: quant,
          separate: "none",
        },
        signal
      );
      setResult(res);
    } catch (e) {
      reportRequestError(e);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const runSeparateAndTranscribe = async () => {
    if (!file || separate === "none" || backendOffline) return;
    resetPlayback();
    setLoading(true);
    setError(null);
    setResult(null);
    const signal = beginAbortableRequest();
    try {
      const res = await transcribe(
        file,
        {
          engine,
          degree,
          chord_complexity: chordComplexity,
          quantize: quant,
          separate,
        },
        signal
      );
      setResult(res);
      if (res.processed_audio_base64) {
        const sepRes: SeparationResult = {
          separate: res.separate,
          duration: res.duration,
          sample_rate: res.sample_rate,
          warnings: res.warnings,
          filename: res.filename,
          processed_audio_base64: res.processed_audio_base64,
        };
        setSeparationResult(sepRes);
        const sepFile = separationResultToFile(sepRes, file.name);
        if (sepFile) {
          setSeparatedFile(sepFile);
          setUseSeparatedForTranscribe(true);
        }
      }
    } catch (e) {
      reportRequestError(e);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const copyTab = () => {
    if (result?.ascii_tab) navigator.clipboard.writeText(result.ascii_tab);
  };

  const downloadTab = () => {
    if (!result?.ascii_tab) return;
    const blob = new Blob([result.ascii_tab], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(result.filename || "tab").replace(/\.[^.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSeparatedAudio = () => {
    const b64 =
      separationResult?.processed_audio_base64 ??
      result?.processed_audio_base64;
    if (!b64) return;
    const base = (
      separationResult?.filename ??
      result?.filename ??
      file?.name ??
      "audio"
    ).replace(/\.[^.]+$/, "");
    const mode =
      separationResult?.separate ??
      (result?.separate !== "none" ? result?.separate : "separated");
    const url = base64ToAudioUrl(b64);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}_${mode}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPng = () => {
    if (view === "staff") {
      staffRef.current?.exportPng(result?.filename);
      return;
    }
    if (view === "dual") {
      dualRef.current?.exportPng(result?.filename);
      return;
    }
    tabRef.current?.exportPng(result?.filename);
  };

  const exportStaffMusicXml = () => {
    if (!result?.staff_musicxml) return;
    downloadMusicXml(result.staff_musicxml, result.filename, "staff");
  };

  const exportTabMusicXml = () => {
    if (!result?.tab_musicxml) return;
    downloadMusicXml(result.tab_musicxml, result.filename, "tab");
  };

  const exportDualMusicXml = () => {
    if (!result?.dual_musicxml) return;
    downloadMusicXml(result.dual_musicxml, result.filename, "dual");
  };

  const canExportChordsOnly = hasMelody && hasChords;

  const exportChordsPng = () => {
    tabRef.current?.exportPng(result?.filename, { chordsOnly: true });
  };

  const exportChordsTabMusicXml = () => {
    if (!result?.tab_musicxml_chords) return;
    downloadMusicXml(result.tab_musicxml_chords, result.filename, "tab-chords");
  };

  const downloadChordsTab = () => {
    if (!result?.ascii_tab_chords) return;
    downloadText(result.ascii_tab_chords, result.filename, "-chords");
  };

  return (
    <div className="app">
      <header className="hero">
        <h1>
          听歌<span className="pick">扒谱</span>
        </h1>
        <p>上传音频，自动识别并生成吉他六线谱（TAB）与五线谱</p>
      </header>

      {backendStatus === "checking" && (
        <div className="backend-banner backend-checking">
          正在检测后端…
        </div>
      )}
      {backendOffline && !busy && (
        <div className="backend-banner backend-offline">
          后端服务不可用，扒谱/分离暂不可用。NAS 上可检查 Docker 后端容器是否运行。
        </div>
      )}

      {/* 1. 上传 */}
      <div className="panel">
        <div
          className={`dropzone ${drag ? "drag" : ""} ${busy ? "disabled" : ""}`}
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => {
            if (busy) return;
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            if (busy) return;
            e.preventDefault();
            setDrag(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="big">🎵 点击或拖拽上传音频</div>
          <div className="sub">支持 mp3 / wav / m4a / flac / ogg（≤ 30MB）</div>
          {file && <div className="file">{file.name}</div>}
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg"
            style={{ display: "none" }}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>
      </div>

      {/* 2. 源音频试听（扒谱输入） */}
      {file && (
        <div className="panel">
          <h3 className="section-title">源音频试听</h3>
          <p className="section-desc">
            试听上传或分离后的音频，确认后再开始扒谱。此处与试听音色无关。
          </p>
          {separatedAudioUrl && (
            <div className="audio-source-row">
              <div className="audio-source-toggle">
                <button
                  type="button"
                  className={audioSource === "original" ? "active" : ""}
                  onClick={() => setAudioSource("original")}
                >
                  原始音频
                </button>
                <button
                  type="button"
                  className={audioSource === "separated" ? "active" : ""}
                  onClick={() => setAudioSource("separated")}
                >
                  {separateLabel}
                </button>
              </div>
              <button
                type="button"
                className="btn ghost"
                onClick={downloadSeparatedAudio}
              >
                下载分离音频
              </button>
            </div>
          )}
          <SourceAudioPlayer src={activeAudioUrl} />
        </div>
      )}

      {/* 3. 扒谱设置（与乐器无关） */}
      {file && (
        <div className={`panel ${busy ? "panel-locked" : ""}`}>
          <h3 className="section-title">扒谱设置</h3>
          <p className="section-desc">
            以下选项只影响如何从音频生成谱面，不改变谱面试听时的合成音色。
          </p>
          <div className="controls">
            <div className="control">
              <h3>
                人声分离 (Demucs)
                <span className={`badge ${capabilityBadgeOn(separateOk) ? "on" : ""}`}>
                  {capabilityBadgeLabel(separateOk)}
                </span>
              </h3>
              <div className="segment">
                {SEPARATES.map((o) => {
                  const disabled =
                    busy ||
                    backendOffline ||
                    (o.id !== "none" && separateOk !== "available");
                  return (
                    <div
                      key={o.id}
                      className={`opt ${separate === o.id ? "active" : ""} ${
                        disabled ? "disabled" : ""
                      }`}
                      onClick={() => !disabled && setSeparate(o.id)}
                    >
                      <div className="t">{o.title}</div>
                      <div className="d">{o.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="control">
              <h3>扒谱引擎</h3>
              <div className="segment">
                {ENGINES.map((o) => {
                  const disabled =
                    busy ||
                    backendOffline ||
                    (o.id === "advanced" && advancedOk !== "available");
                  return (
                    <div
                      key={o.id}
                      className={`opt ${engine === o.id ? "active" : ""} ${
                        disabled ? "disabled" : ""
                      }`}
                      onClick={() => !disabled && setEngine(o.id)}
                    >
                      <div className="t">
                        {o.title}
                        {o.id === "advanced" && (
                          <span
                            className={`badge ${capabilityBadgeOn(advancedOk) ? "on" : ""}`}
                          >
                            {capabilityBadgeLabel(advancedOk)}
                          </span>
                        )}
                      </div>
                      <div className="d">{o.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="control">
              <h3>扒谱程度</h3>
              <div className="segment">
                {DEGREES.map((o) => {
                  const disabled = busy;
                  return (
                    <div
                      key={o.id}
                      className={`opt ${degree === o.id ? "active" : ""} ${
                        disabled ? "disabled" : ""
                      }`}
                      onClick={() => !disabled && setDegree(o.id)}
                    >
                      <div className="t">{o.title}</div>
                      <div className="d">{o.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {showChordComplexity && (
              <div className="control">
                <h3>和弦复杂度</h3>
                <div className="segment">
                  {CHORD_COMPLEXITIES.map((o) => {
                    const disabled = busy;
                    return (
                      <div
                        key={o.id}
                        className={`opt ${
                          chordComplexity === o.id ? "active" : ""
                        } ${disabled ? "disabled" : ""}`}
                        onClick={() =>
                          !disabled && setChordComplexity(o.id)
                        }
                      >
                        <div className="t">{o.title}</div>
                        <div className="d">{o.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="control">
              <h3>节奏量化</h3>
              <div className="segment">
                {QUANTS.map((o) => {
                  const disabled = busy;
                  return (
                    <div
                      key={o.id}
                      className={`opt ${quant === o.id ? "active" : ""} ${
                        disabled ? "disabled" : ""
                      }`}
                      onClick={() => !disabled && setQuant(o.id)}
                    >
                      <div className="t">{o.title}</div>
                      <div className="d">{o.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {separatedFile && (
            <label
              className="row"
              style={{ marginTop: 12, fontSize: 13, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={useSeparatedForTranscribe}
                onChange={(e) => setUseSeparatedForTranscribe(e.target.checked)}
                disabled={busy}
                style={{ marginRight: 8 }}
              />
              开始扒谱时使用已分离的音频（不再重复跑 Demucs）
            </label>
          )}

          <div className="row" style={{ marginTop: 20, flexWrap: "wrap", gap: 10 }}>
            {(separateOk === "available" || separateOk === "loading") && (
              <>
                <button
                  className="btn ghost"
                  disabled={
                    busy ||
                    backendOffline ||
                    separate === "none" ||
                    separateOk === "loading"
                  }
                  title={
                    separate === "none"
                      ? "请先在上方选择分离模式（如「去人声」）"
                      : separateOk === "loading"
                      ? "正在检测 Demucs 是否可用"
                      : backendOffline
                      ? "后端服务不可用"
                      : undefined
                  }
                  onClick={runSeparateOnly}
                >
                  {separating && <span className="spinner" />}
                  {separating ? "正在分离…" : "开始分离"}
                </button>
                <button
                  className="btn"
                  disabled={
                    busy ||
                    backendOffline ||
                    separate === "none" ||
                    separateOk === "loading"
                  }
                  title={
                    separate === "none"
                      ? "请先在上方选择分离模式（如「去人声」）"
                      : separateOk === "loading"
                      ? "正在检测 Demucs 是否可用"
                      : backendOffline
                      ? "后端服务不可用"
                      : undefined
                  }
                  onClick={runSeparateAndTranscribe}
                >
                  {loading && <span className="spinner" />}
                  {loading ? "分离并扒谱…" : "分离并扒谱"}
                </button>
              </>
            )}
            <button
              className="btn"
              disabled={busy || backendOffline}
              title={backendOffline ? "后端服务不可用" : undefined}
              onClick={runTranscribeOnly}
            >
              {loading && <span className="spinner" />}
              {transcribeButtonLabel}
            </button>
            {busy && (
              <button
                type="button"
                className="btn ghost"
                onClick={cancelBusy}
              >
                取消
              </button>
            )}
          </div>
        </div>
      )}

      {busy && (
        <div className="panel panel-busy">
          <div className="busy-status">
            <div className="busy-status-head">
              <span className="spinner" />
              <strong>{busyStage.title}</strong>
              {healthOk && busyElapsedSec >= 30 && (
                <span className="backend-online-hint">后端在线</span>
              )}
            </div>
            <p className="busy-status-sub">{busyStage.subtitle}</p>
            <p className="busy-status-elapsed">
              已处理 {formatBusyElapsed(busyElapsedSec)} · 请勿关闭页面
            </p>
            {busyReassurance && (
              <p className="busy-status-hint">{busyReassurance}</p>
            )}
            <div className="progress-indeterminate" aria-hidden="true" />
          </div>
        </div>
      )}

      {error && (
        <div className="panel">
          <div className="error">⚠️ {error}</div>
        </div>
      )}

      {/* 结果区 */}
      {result && (
        <div className="panel">
          <div className="meta">
            <span>
              文件: <b>{result.filename}</b>
            </span>
            <span>
              速度: <b>{result.tempo.toFixed(0)} BPM</b>
            </span>
            <span>
              时长: <b>{result.duration.toFixed(1)}s</b>
            </span>
            <span>
              音符数: <b>{result.notes.length}</b>
            </span>
            <span>
              小节: <b>{result.measures}</b>
            </span>
            {result.chords.length > 0 && (
              <span>
                和弦: <b>{result.chords.length}</b>
              </span>
            )}
          </div>

          {result.warnings.map((w, i) => (
            <div className="warn" key={i}>
              ⚠ {w}
            </div>
          ))}

          <div className="tabs-switch">
            <button
              className={view === "svg" ? "active" : ""}
              onClick={() => setView("svg")}
            >
              可视化六线谱
            </button>
            <button
              className={view === "staff" ? "active" : ""}
              onClick={() => setView("staff")}
            >
              五线谱
            </button>
            <button
              className={view === "dual" ? "active" : ""}
              onClick={() => setView("dual")}
            >
              双谱表
            </button>
            <button
              className={view === "ascii" ? "active" : ""}
              onClick={() => setView("ascii")}
            >
              ASCII 六线谱
            </button>
            <div style={{ flex: 1 }} />
            {(view === "svg" || view === "staff" || view === "dual") &&
              hasTabContent && (
              <button className="btn ghost" onClick={exportPng}>
                导出 PNG
              </button>
            )}
            {view === "svg" && result.tab_musicxml && (
              <button className="btn ghost" onClick={exportTabMusicXml}>
                下载 TAB
              </button>
            )}
            {view === "staff" && result.staff_musicxml && (
              <button className="btn ghost" onClick={exportStaffMusicXml}>
                下载五线谱
              </button>
            )}
            {view === "dual" && result.dual_musicxml && (
              <button className="btn ghost" onClick={exportDualMusicXml}>
                下载双谱表
              </button>
            )}
            {view === "ascii" && (
              <>
                <button className="btn ghost" onClick={copyTab}>
                  复制
                </button>
                <button className="btn ghost" onClick={downloadTab}>
                  下载 .txt
                </button>
              </>
            )}
            {canExportChordsOnly && (
              <>
                {view === "svg" && (
                  <button className="btn ghost" onClick={exportChordsPng}>
                    导出和弦 PNG
                  </button>
                )}
                {result.tab_musicxml_chords && (
                  <button className="btn ghost" onClick={exportChordsTabMusicXml}>
                    下载和弦 TAB
                  </button>
                )}
                {view === "ascii" && result.ascii_tab_chords && (
                  <button className="btn ghost" onClick={downloadChordsTab}>
                    下载和弦 .txt
                  </button>
                )}
              </>
            )}
          </div>

          {((view === "svg" && result.tab_musicxml) ||
            (view === "dual" && result.dual_musicxml)) && (
            <p className="section-desc">
              MusicXML 建议使用 MuseScore 4.x 打开。双谱表若在 MuseScore
              中五线谱与六线谱未联动，可在乐器面板从 TAB 谱表创建联动五线谱。
            </p>
          )}

          {!hasTabContent ? (
            <div className="warn">没有可显示的谱面内容。</div>
          ) : (
            <>
              <h3 className="section-title preview-section-title">
                谱面试听
              </h3>
              <p className="section-desc">
                {hasMelody && hasChords
                  ? "按识别出的旋律与和弦合成试听，可切换试听内容；音色仅影响此处播放。"
                  : hasMelody
                    ? "按识别出的音符合成试听，音色仅影响此处播放效果，与扒谱过程无关。"
                    : "按识别出的和弦走向合成试听，吉他/尤克里里为扫弦效果。"}
              </p>
              <div className="transport">
                {canPreview ? (
                  <>
                    <button
                      className={`transport-btn play ${isPlaying ? "playing" : ""}`}
                      type="button"
                      onClick={() => void togglePlay()}
                      title={isPlaying ? "暂停" : "播放"}
                      aria-label={isPlaying ? "暂停" : "播放"}
                    >
                      {isPlaying ? (
                        <IconPause className="transport-icon" />
                      ) : (
                        <IconPlay className="transport-icon" />
                      )}
                    </button>
                    <button
                      className="transport-btn"
                      type="button"
                      onClick={stopPlayback}
                      title="停止"
                      aria-label="停止"
                    >
                      <IconStop className="transport-icon" />
                    </button>
                  </>
                ) : null}
                <input
                  className="transport-seek"
                  type="range"
                  min={0}
                  max={result.duration}
                  step={0.01}
                  value={Math.min(currentTime, result.duration)}
                  onChange={(e) => seekPlayback(Number(e.target.value))}
                />
                <span className="transport-time">
                  {formatTime(currentTime)} / {formatTime(result.duration)}
                </span>
                {canPreview ? (
                  <>
                    {hasMelody && hasChords ? (
                      <label className="transport-speed">
                        <span className="transport-speed-label">试听</span>
                        <select
                          value={previewMode}
                          onChange={(e) =>
                            setPreviewMode(e.target.value as PreviewMode)
                          }
                          title="选择谱面合成试听内容"
                        >
                          <option value="melody">旋律</option>
                          <option value="chords">和弦</option>
                          <option value="both">旋律+和弦</option>
                        </select>
                      </label>
                    ) : null}
                    <label className="transport-speed">
                      <span className="transport-speed-label">速度</span>
                      <select
                        value={playbackSpeed}
                        onChange={(e) =>
                          handleSpeedChange(
                            Number(e.target.value) as PlaybackSpeed
                          )
                        }
                      >
                        {PLAYBACK_SPEEDS.map((s) => (
                          <option key={s} value={s}>
                            {s === 1 ? "1×" : `${s}×`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="transport-speed">
                      <span className="transport-speed-label">试听音色</span>
                      <select
                        value={instrument}
                        onChange={(e) =>
                          setInstrument(e.target.value as Instrument)
                        }
                        title="仅影响谱面合成试听"
                      >
                        {INSTRUMENTS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {INSTRUMENT_LABELS[o.id]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
              </div>
              {canPreview && (
                <p className="transport-hint">
                  {result.quantize !== "none" ? (
                    <>
                      音符已按
                      {QUANTS.find((q) => q.id === result.quantize)?.title}
                      量化；1× 速度与谱面网格一致（≈{result.tempo.toFixed(0)}{" "}
                      BPM），变速等比缩放时值
                      {playbackSpeed !== 1 && (
                        <>
                          ，当前约{" "}
                          {(result.tempo * playbackSpeed).toFixed(0)} BPM
                        </>
                      )}
                      。
                    </>
                  ) : (
                    <>
                      播放速度可选；1× 为原始时值
                      {playbackSpeed !== 1 && (
                        <>
                          ，当前约{" "}
                          {(result.tempo * playbackSpeed).toFixed(0)} BPM
                        </>
                      )}
                      。
                    </>
                  )}
                </p>
              )}

              {view === "svg" ? (
                <TabView
                  ref={tabRef}
                  notes={result.notes}
                  chords={result.chords}
                  tuning={result.tuning}
                  duration={result.duration}
                  tempo={result.tempo}
                  filename={result.filename}
                  currentTime={currentTime}
                  activeNotes={activeNotes}
                  activeChords={activeChords}
                />
              ) : view === "staff" ? (
                <StaffView
                  ref={staffRef}
                  musicxml={result.staff_musicxml}
                  notes={result.notes}
                  tempo={result.tempo}
                  duration={result.duration}
                  currentTime={currentTime}
                  filename={result.filename}
                />
              ) : view === "dual" ? (
                <StaffView
                  ref={dualRef}
                  musicxml={result.dual_musicxml}
                  notes={result.notes}
                  tempo={result.tempo}
                  duration={result.duration}
                  currentTime={currentTime}
                  filename={result.filename}
                  label="双谱表"
                  loadingLabel="正在渲染双谱表…"
                />
              ) : (
                <pre className="tab-ascii">{result.ascii_tab}</pre>
              )}
            </>
          )}
        </div>
      )}

      <footer>
        song-to-tab · 生成的谱子为辅助草稿，建议人工校对 · 单声部/主旋律识别最可靠
      </footer>
    </div>
  );
}
