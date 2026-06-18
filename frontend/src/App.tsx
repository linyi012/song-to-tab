import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkCapabilities,
  transcribe,
  type Degree,
  type Engine,
  type Quantize,
  type Separate,
  type TranscriptionResult,
} from "./api";
import { TabPlayer, PLAYBACK_SPEEDS, type PlaybackSpeed } from "./player";
import TabView, { type TabViewHandle } from "./TabView";
import StaffView, { type StaffViewHandle } from "./StaffView";
import { downloadMusicXml } from "./staffExport";
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

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [engine, setEngine] = useState<Engine>("realistic");
  const [degree, setDegree] = useState<Degree>("simple");
  const [quant, setQuant] = useState<Quantize>("none");
  const [separate, setSeparate] = useState<Separate>("none");
  const [instrument, setInstrument] = useState<Instrument>("guitar");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TranscriptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancedOk, setAdvancedOk] = useState<boolean | null>(null);
  const [separateOk, setSeparateOk] = useState<boolean | null>(null);
  const [view, setView] = useState<"svg" | "staff" | "ascii">("svg");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [audioSource, setAudioSource] = useState<"original" | "separated">(
    "original"
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<TabViewHandle>(null);
  const staffRef = useRef<StaffViewHandle>(null);
  const playerRef = useRef<TabPlayer | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    checkCapabilities().then((caps) => {
      setAdvancedOk(caps.advanced);
      setSeparateOk(caps.separate);
    });
  }, []);

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

  const separatedAudioUrl = useMemo(() => {
    if (!result?.processed_audio_base64) return null;
    return base64ToAudioUrl(result.processed_audio_base64);
  }, [result?.processed_audio_base64]);

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
    if (!result || result.separate === "none") return "分离后";
    const opt = SEPARATES.find((s) => s.id === result.separate);
    return opt ? `分离后 · ${opt.title}` : "分离后";
  }, [result]);

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
    if (result && result.notes.length > 0) {
      player.load(result.notes, result.duration);
      player.setInstrument(instrument);
      player.setPlaybackRate(1);
    } else {
      player.unload();
    }
  }, [result, instrument]);

  useEffect(() => {
    playerRef.current?.setInstrument(instrument);
  }, [instrument]);

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
  const hasTabContent = Boolean(
    result && (result.notes.length > 0 || result.chords.length > 0)
  );

  const activeNotes = useMemo(() => {
    if (!result) return new Set<number>();
    const set = new Set<number>();
    result.notes.forEach((n, i) => {
      if (n.start <= currentTime && currentTime < n.end) set.add(i);
    });
    return set;
  }, [result, currentTime]);

  const togglePlay = useCallback(async () => {
    const player = playerRef.current;
    if (!player || !result?.notes.length) return;
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
  }, [currentTime, result]);

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
      if (player && result.notes.length > 0) {
        player.seek(sec);
        setIsPlaying(player.isPlaying);
      }
      setCurrentTime(sec);
    },
    [result]
  );

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    resetPlayback();
    setFile(f);
    setResult(null);
    setError(null);
  };

  const run = async () => {
    if (!file) return;
    resetPlayback();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await transcribe(file, {
        engine,
        degree,
        quantize: quant,
        separate,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
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
    if (!result?.processed_audio_base64) return;
    const base = (result.filename || file?.name || "audio").replace(
      /\.[^.]+$/,
      ""
    );
    const mode = result.separate !== "none" ? result.separate : "separated";
    const url = base64ToAudioUrl(result.processed_audio_base64);
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
    tabRef.current?.exportPng(result?.filename);
  };

  const exportMusicXml = () => {
    if (!result?.musicxml) return;
    downloadMusicXml(result.musicxml, result.filename);
  };

  return (
    <div className="app">
      <header className="hero">
        <h1>
          听歌<span className="pick">扒谱</span>
        </h1>
        <p>上传音频，自动识别并生成吉他六线谱（TAB）与五线谱</p>
      </header>

      {/* 1. 上传 */}
      <div className="panel">
        <div
          className={`dropzone ${drag ? "drag" : ""} ${loading ? "disabled" : ""}`}
          onClick={() => !loading && inputRef.current?.click()}
          onDragOver={(e) => {
            if (loading) return;
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            if (loading) return;
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
        <div className={`panel ${loading ? "panel-locked" : ""}`}>
          <h3 className="section-title">扒谱设置</h3>
          <p className="section-desc">
            以下选项只影响如何从音频生成谱面，不改变谱面试听时的合成音色。
          </p>
          <div className="controls">
            <div className="control">
              <h3>
                人声分离 (Demucs)
                <span className={`badge ${separateOk ? "on" : ""}`}>
                  {separateOk === null
                    ? "检测中"
                    : separateOk
                    ? "可用"
                    : "未安装"}
                </span>
              </h3>
              <div className="segment">
                {SEPARATES.map((o) => {
                  const disabled =
                    loading || (o.id !== "none" && separateOk === false);
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
                    loading || (o.id === "advanced" && advancedOk === false);
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
                          <span className={`badge ${advancedOk ? "on" : ""}`}>
                            {advancedOk === null
                              ? "检测中"
                              : advancedOk
                              ? "可用"
                              : "未安装"}
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
                  const disabled = loading;
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

            <div className="control">
              <h3>节奏量化</h3>
              <div className="segment">
                {QUANTS.map((o) => {
                  const disabled = loading;
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

          <div className="row" style={{ marginTop: 20 }}>
            <button className="btn" disabled={loading} onClick={run}>
              {loading && <span className="spinner" />}
              {loading ? "正在扒谱…" : "开始扒谱"}
            </button>
            {loading && (
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                {separate !== "none"
                  ? "Demucs 分离可能较慢（首次运行需下载模型）"
                  : "首次运行进阶引擎可能较慢（加载模型）"}
              </span>
            )}
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
              className={view === "ascii" ? "active" : ""}
              onClick={() => setView("ascii")}
            >
              ASCII 六线谱
            </button>
            <div style={{ flex: 1 }} />
            {(view === "svg" || view === "staff") && hasTabContent && (
              <button className="btn ghost" onClick={exportPng}>
                导出 PNG
              </button>
            )}
            {view === "staff" && result.musicxml && (
              <button className="btn ghost" onClick={exportMusicXml}>
                下载 MusicXML
              </button>
            )}
            <button className="btn ghost" onClick={copyTab}>
              复制
            </button>
            <button className="btn ghost" onClick={downloadTab}>
              下载 .txt
            </button>
          </div>

          {!hasTabContent ? (
            <div className="warn">没有可显示的谱面内容。</div>
          ) : (
            <>
              <h3 className="section-title preview-section-title">
                谱面试听
              </h3>
              <p className="section-desc">
                {hasMelody
                  ? "按识别出的音符合成试听，音色仅影响此处播放效果，与扒谱过程无关。"
                  : "仅和弦模式无可合成旋律；拖动进度条可定位当前和弦位置。"}
              </p>
              <div className="transport">
                {hasMelody ? (
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
                {hasMelody ? (
                  <>
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
              {hasMelody && (
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
                />
              ) : view === "staff" ? (
                <StaffView
                  ref={staffRef}
                  musicxml={result.musicxml}
                  notes={result.notes}
                  tempo={result.tempo}
                  duration={result.duration}
                  currentTime={currentTime}
                  filename={result.filename}
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
