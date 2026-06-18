import type { Instrument } from "./instruments";

const CHORD_RE =
  /^([A-G])([#b]?)(m(in(or)?)?|maj7|m7|7|sus4|dim|aug)?$/i;

const ROOT_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export type ChordQuality =
  | "major"
  | "minor"
  | "maj7"
  | "m7"
  | "7"
  | "sus4"
  | "dim"
  | "aug";

/** 解析和弦名，与后端 staff.CHORD_RE 一致。 */
export function parseChordName(
  name: string
): { rootPc: number; quality: ChordQuality } | null {
  const m = CHORD_RE.exec(name.trim());
  if (!m) return null;
  const step = m[1].toUpperCase();
  const acc = m[2];
  let rootPc = ROOT_PC[step];
  if (rootPc === undefined) return null;
  if (acc === "#") rootPc = (rootPc + 1) % 12;
  else if (acc === "b") rootPc = (rootPc + 11) % 12;

  const suffix = (m[3] || "").toLowerCase();
  let quality: ChordQuality = "major";
  if (!suffix) quality = "major";
  else if (suffix === "m" || suffix === "min" || suffix === "minor")
    quality = "minor";
  else if (suffix === "maj7") quality = "maj7";
  else if (suffix === "m7") quality = "m7";
  else if (suffix === "7") quality = "7";
  else if (suffix === "sus4") quality = "sus4";
  else if (suffix === "dim") quality = "dim";
  else if (suffix === "aug") quality = "aug";

  return { rootPc, quality };
}

function chordIntervals(quality: ChordQuality): number[] {
  switch (quality) {
    case "major":
      return [0, 4, 7];
    case "minor":
      return [0, 3, 7];
    case "maj7":
      return [0, 4, 7, 11];
    case "m7":
      return [0, 3, 7, 10];
    case "7":
      return [0, 4, 7, 10];
    case "sus4":
      return [0, 5, 7];
    case "dim":
      return [0, 3, 6];
    case "aug":
      return [0, 4, 8];
    default:
      return [0, 4, 7];
  }
}

/** 将 pitch class 放到 [baseMidi, baseMidi+11] 区间。 */
function pcToMidi(pc: number, baseMidi: number): number {
  const basePc = ((baseMidi % 12) + 12) % 12;
  let midi = baseMidi - basePc + pc;
  if (midi < baseMidi) midi += 12;
  return midi;
}

const BASE_MIDI: Record<Instrument, number> = {
  guitar: 48, // C3 附近
  ukulele: 55,
  piano: 60, // C4
};

/**
 * 和弦名 → MIDI 列表（根音在上）。
 * 试听用封闭和弦，不模拟具体把位。
 */
export function chordNameToMidi(
  name: string,
  instrument: Instrument = "guitar"
): number[] {
  const parsed = parseChordName(name);
  if (!parsed) return [];

  const base = BASE_MIDI[instrument];
  const intervals = chordIntervals(parsed.quality);
  const pcs = intervals.map((iv) => (parsed.rootPc + iv) % 12);

  const rootMidi = pcToMidi(parsed.rootPc, base);
  const midis = [rootMidi];
  for (let k = 1; k < pcs.length; k++) {
    let m = pcToMidi(pcs[k], rootMidi);
    while (m <= midis[midis.length - 1]) m += 12;
    midis.push(m);
  }
  return midis;
}
