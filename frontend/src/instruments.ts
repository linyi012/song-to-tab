export type Instrument = "guitar" | "piano" | "ukulele";

export const INSTRUMENT_LABELS: Record<Instrument, string> = {
  guitar: "吉他",
  piano: "钢琴",
  ukulele: "尤克里里",
};

function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Karplus-Strong 拨弦：适合吉他 / 尤克里里 */
function schedulePlucked(
  ctx: AudioContext,
  dest: AudioNode,
  midi: number,
  t0: number,
  dur: number,
  vel: number,
  brightness: number
): AudioScheduledSourceNode[] {
  const sampleRate = ctx.sampleRate;
  const freq = midiToFreq(midi);
  const period = Math.max(2, Math.round(sampleRate / freq));
  const len = Math.max(period + 1, Math.ceil(dur * sampleRate));
  const buf = ctx.createBuffer(1, len, sampleRate);
  const data = buf.getChannelData(0);
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) {
    ring[i] = (Math.random() * 2 - 1) * vel * 0.62;
  }
  const decay = 0.998 - (1 - brightness) * 0.008;
  let ptr = 0;
  for (let i = 0; i < len; i++) {
    data[i] = ring[ptr];
    ring[ptr] = ((ring[ptr] + ring[(ptr + 1) % period]) * 0.5) * decay;
    ptr = (ptr + 1) % period;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1200 + brightness * 3600, t0);
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, t0);
  gain.gain.linearRampToValueAtTime(vel * 0.85, t0 + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
  return [src];
}

/** 钢琴：多谐波衰减 */
function schedulePiano(
  ctx: AudioContext,
  dest: AudioNode,
  midi: number,
  t0: number,
  dur: number,
  vel: number
): AudioScheduledSourceNode[] {
  const freq = midiToFreq(midi);
  const harmonics = [1, 2, 3, 4, 6];
  const weights = [1, 0.6, 0.35, 0.22, 0.1];
  const sources: OscillatorNode[] = [];

  harmonics.forEach((h, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * h, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vel * weights[i] * 0.45, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    sources.push(osc);
  });

  return sources;
}

export function scheduleInstrumentNote(
  ctx: AudioContext,
  dest: AudioNode,
  instrument: Instrument,
  midi: number,
  t0: number,
  dur: number,
  vel: number,
  stringIndex?: number
): AudioScheduledSourceNode[] {
  const brightness =
    instrument === "ukulele"
      ? 0.75
      : 0.35 + ((stringIndex ?? 3) / 5) * 0.45;

  switch (instrument) {
    case "piano":
      return schedulePiano(ctx, dest, midi, t0, dur, vel);
    case "guitar":
    case "ukulele":
    default:
      return schedulePlucked(ctx, dest, midi, t0, dur, vel, brightness);
  }
}

const STRUM_SPREAD_SEC = 0.016;

/** 和弦试听：吉他/尤克里里扫弦，钢琴块状和弦。 */
export function scheduleChord(
  ctx: AudioContext,
  dest: AudioNode,
  instrument: Instrument,
  midis: number[],
  t0: number,
  dur: number,
  vel: number
): AudioScheduledSourceNode[] {
  if (midis.length === 0) return [];

  const chordVel = vel * 0.72;
  const playDur = Math.max(0.28, dur);
  const sources: AudioScheduledSourceNode[] = [];

  if (instrument === "piano") {
    for (const midi of midis) {
      sources.push(
        ...schedulePiano(ctx, dest, midi, t0, playDur, chordVel / midis.length)
      );
    }
    return sources;
  }

  const brightness = instrument === "ukulele" ? 0.72 : 0.5;
  const ordered = [...midis].sort((a, b) => b - a);
  ordered.forEach((midi, i) => {
    const noteT0 = t0 + i * STRUM_SPREAD_SEC;
    sources.push(
      ...schedulePlucked(
        ctx,
        dest,
        midi,
        noteT0,
        playDur,
        chordVel / ordered.length,
        brightness
      )
    );
  });
  return sources;
}
