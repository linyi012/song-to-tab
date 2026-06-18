export type Engine = "realistic" | "advanced";
export type Degree = "simple" | "chords" | "medium" | "full";
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
  musicxml: string;
  warnings: string[];
  filename?: string;
  processed_audio_base64?: string | null;
}

export interface TranscribeOptions {
  engine: Engine;
  degree: Degree;
  quantize: Quantize;
  separate: Separate;
}

const API_BASE = "/api";

export async function transcribe(
  file: File,
  opts: TranscribeOptions
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("engine", opts.engine);
  form.append("degree", opts.degree);
  form.append("quantize", opts.quantize);
  form.append("separate", opts.separate);

  const res = await fetch(`${API_BASE}/transcribe`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export interface Capabilities {
  advanced: boolean;
  separate: boolean;
}

export async function checkCapabilities(): Promise<Capabilities> {
  try {
    const res = await fetch(`${API_BASE}/`);
    const data = await res.json();
    return {
      advanced: Boolean(data?.advanced_available),
      separate: Boolean(data?.separate_available),
    };
  } catch {
    return { advanced: false, separate: false };
  }
}

/** @deprecated use checkCapabilities */
export async function checkAdvanced(): Promise<boolean> {
  const caps = await checkCapabilities();
  return caps.advanced;
}
