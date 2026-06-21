export type Engine = "realistic" | "advanced";
export type Degree = "simple" | "chords" | "medium" | "full";
export type ChordComplexity = "rich" | "standard" | "simple" | "minimal";
export type Quantize = "none" | "quarter" | "eighth" | "sixteenth";
export type Separate = "none" | "no_vocals" | "vocals" | "other";

export interface Note {
  midi: number;
  name: string;
  start: number;
  end: number;
  velocity: number;
  string: number; // 0 = 低音E弦 ... 5 = 高音e弦
  fret: number;
}

export interface Chord {
  name: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  engine: Engine;
  degree: Degree;
  chord_complexity: ChordComplexity;
  quantize: Quantize;
  separate: Separate;
  tempo: number;
  duration: number;
  sample_rate: number;
  tuning: string[];
  notes: Note[];
  chords: Chord[];
  measures: number;
  ascii_tab: string;
  ascii_tab_chords?: string;
  staff_musicxml: string;
  tab_musicxml: string;
  tab_musicxml_chords?: string;
  dual_musicxml: string;
  warnings: string[];
  filename?: string;
  processed_audio_base64?: string | null;
}

export interface SeparationResult {
  separate: Separate;
  duration: number;
  sample_rate: number;
  warnings: string[];
  filename?: string;
  processed_audio_base64?: string | null;
}

export interface TranscribeOptions {
  engine: Engine;
  degree: Degree;
  chord_complexity: ChordComplexity;
  quantize: Quantize;
  separate: Separate;
}

export type CapabilityStatus =
  | "loading"
  | "available"
  | "unavailable"
  | "unreachable";

export interface Capabilities {
  advanced: CapabilityStatus;
  separate: CapabilityStatus;
  backendReachable: boolean;
}

const API_BASE = "/api";

export type AbortReason = "user" | "timeout" | "backend";

interface ApiFetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function mergeSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "any" in AbortSignal) {
    return (AbortSignal as typeof AbortSignal & { any: (s: AbortSignal[]) => AbortSignal }).any(
      signals
    );
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

function abortError(reason: AbortReason): DOMException {
  return new DOMException(reason, "AbortError");
}

async function parseError(res: Response): Promise<string> {
  let detail = `请求失败 (${res.status})`;
  try {
    const data = await res.json();
    if (data?.detail) {
      detail =
        typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail);
    }
  } catch {
    /* ignore */
  }
  return detail;
}

export function formatFetchError(err: unknown, res?: Response): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    const reason = String(err.message);
    if (reason === "superseded") return "";
    if (reason === "user") return "操作已取消";
    if (reason === "backend") return "后端服务已断开，操作已中止";
    return "请求超时，后端可能无响应，请稍后重试";
  }
  if (res && !res.ok) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return `后端服务不可用 (${res.status})`;
    }
  }
  if (err instanceof TypeError) {
    return "无法连接后端服务";
  }
  if (err instanceof Error) {
    if (err.message === "Failed to fetch") return "无法连接后端服务";
    return err.message;
  }
  return String(err);
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts: ApiFetchOptions = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(abortError("timeout")),
    timeoutMs
  );
  const signals = [timeoutController.signal];
  if (opts.signal) signals.push(opts.signal);

  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: mergeSignals(signals),
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await apiFetch(
      "/health",
      {},
      { timeoutMs: 8_000, signal }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

async function fetchCapabilityStatus(
  path: string,
  signal?: AbortSignal
): Promise<CapabilityStatus> {
  try {
    const res = await apiFetch(path, {}, { timeoutMs: 15_000, signal });
    if (!res.ok) {
      return res.status >= 500 ? "unreachable" : "unavailable";
    }
    const data = await res.json();
    return data?.available ? "available" : "unavailable";
  } catch {
    return "unreachable";
  }
}

export async function checkCapabilities(
  signal?: AbortSignal
): Promise<Capabilities> {
  const [separate, advanced] = await Promise.all([
    fetchCapabilityStatus("/capabilities/separate", signal),
    fetchCapabilityStatus("/capabilities/advanced", signal),
  ]);
  const backendReachable =
    separate !== "unreachable" && advanced !== "unreachable";
  return { separate, advanced, backendReachable };
}

export async function transcribe(
  file: File,
  opts: TranscribeOptions,
  signal?: AbortSignal
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("engine", opts.engine);
  form.append("degree", opts.degree);
  form.append("chord_complexity", opts.chord_complexity);
  form.append("quantize", opts.quantize);
  form.append("separate", opts.separate);

  let res: Response;
  try {
    res = await apiFetch(
      "/transcribe",
      { method: "POST", body: form },
      { timeoutMs: 3_600_000, signal }
    );
  } catch (err) {
    throw new Error(formatFetchError(err));
  }

  if (!res.ok) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(`后端服务不可用 (${res.status})`);
    }
    throw new Error(await parseError(res));
  }
  return res.json();
}

export async function separateAudio(
  file: File,
  mode: Exclude<Separate, "none">,
  signal?: AbortSignal
): Promise<SeparationResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("separate", mode);

  let res: Response;
  try {
    res = await apiFetch(
      "/separate",
      { method: "POST", body: form },
      { timeoutMs: 3_600_000, signal }
    );
  } catch (err) {
    throw new Error(formatFetchError(err));
  }

  if (!res.ok) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(`后端服务不可用 (${res.status})`);
    }
    throw new Error(await parseError(res));
  }
  return res.json();
}

/** @deprecated use checkCapabilities */
export async function checkAdvanced(): Promise<boolean> {
  const caps = await checkCapabilities();
  return caps.advanced === "available";
}

export function separationResultToFile(
  result: SeparationResult,
  fallbackName = "separated.wav"
): File | null {
  const b64 = result.processed_audio_base64;
  if (!b64) return null;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const base = (result.filename || fallbackName).replace(/\.[^.]+$/, "");
  const mode = result.separate !== "none" ? result.separate : "separated";
  return new File([bytes], `${base}_${mode}.wav`, { type: "audio/wav" });
}
