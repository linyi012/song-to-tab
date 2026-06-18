import type { Chord, Note } from "./api";
import { chordNameToMidi } from "./chordVoicings";
import {
  type Instrument,
  scheduleChord,
  scheduleInstrumentNote,
} from "./instruments";

export type PlaybackSpeed = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
export type PreviewMode = "melody" | "chords" | "both";

export const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

const MIN_PLAY_DUR = 0.28;
const RELEASE_TAIL = 0.15;
const CHORD_VEL_SCALE = 0.6;

export class TabPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private notes: Note[] = [];
  private chords: Chord[] = [];
  private duration = 0;
  private previewMode: PreviewMode = "melody";
  private playing = false;
  private startCtxTime = 0;
  private startSongTime = 0;
  private scheduled: AudioScheduledSourceNode[] = [];
  private endTimer: number | null = null;
  private instrument: Instrument = "guitar";
  private rate: PlaybackSpeed = 1;
  private generation = 0;
  onEnded: (() => void) | null = null;

  load(
    notes: Note[],
    chords: Chord[],
    duration: number,
    mode: PreviewMode = "melody"
  ) {
    this.stop();
    this.notes = notes;
    this.chords = chords;
    this.duration = duration;
    this.previewMode = mode;
  }

  setPreviewMode(mode: PreviewMode) {
    this.previewMode = mode;
    if (this.playing) {
      const t = this.currentTime;
      void this.play(t);
    }
  }

  setInstrument(instrument: Instrument) {
    this.instrument = instrument;
    if (this.playing) {
      const t = this.currentTime;
      void this.play(t);
    }
  }

  setPlaybackRate(rate: PlaybackSpeed) {
    this.rate = rate;
    if (this.playing) {
      const t = this.currentTime;
      void this.play(t);
    }
  }

  get playbackRate(): PlaybackSpeed {
    return this.rate;
  }

  get currentInstrument(): Instrument {
    return this.instrument;
  }

  get currentPreviewMode(): PreviewMode {
    return this.previewMode;
  }

  get currentTime(): number {
    if (!this.playing || !this.ctx) return this.startSongTime;
    return (
      this.startSongTime +
      (this.ctx.currentTime - this.startCtxTime) * this.rate
    );
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get songDuration(): number {
    return this.duration;
  }

  private hasPreviewContent(): boolean {
    const { previewMode } = this;
    if (previewMode === "melody") return this.notes.length > 0;
    if (previewMode === "chords") return this.chords.length > 0;
    return this.notes.length > 0 || this.chords.length > 0;
  }

  private bumpGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 18;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(compressor);
      compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  private clearScheduled() {
    if (this.endTimer !== null) {
      window.clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    for (const node of this.scheduled) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    this.scheduled = [];
  }

  private scheduleEnd(fromSec: number, gen: number) {
    const remaining = ((this.duration - fromSec) / this.rate) * 1000 + 30;
    if (remaining <= 0) {
      this.playing = false;
      this.startSongTime = this.duration;
      this.onEnded?.();
      return;
    }
    this.endTimer = window.setTimeout(() => {
      if (this.playing && this.generation === gen) {
        this.playing = false;
        this.startSongTime = this.duration;
        this.clearScheduled();
        this.onEnded?.();
      }
    }, remaining);
  }

  private scheduleNote(note: Note, offsetSec: number, velScale = 1) {
    const ctx = this.ctx!;
    const master = this.master!;
    const t0 = ctx.currentTime + offsetSec;
    const gridDur = Math.max(0.05, (note.end - note.start) / this.rate);
    const playDur = Math.max(MIN_PLAY_DUR, gridDur) + RELEASE_TAIL;
    const vel = Math.max(0.05, Math.min(1, note.velocity * velScale));

    const sources = scheduleInstrumentNote(
      ctx,
      master,
      this.instrument,
      note.midi,
      t0,
      playDur,
      vel,
      note.string
    );
    this.scheduled.push(...sources);
  }

  private scheduleChordEvent(chord: Chord, offsetSec: number, velScale = 1) {
    const midis = chordNameToMidi(chord.name, this.instrument);
    if (midis.length === 0) return;

    const ctx = this.ctx!;
    const master = this.master!;
    const t0 = ctx.currentTime + offsetSec;
    const gridDur = Math.max(0.05, (chord.end - chord.start) / this.rate);
    const playDur = Math.max(MIN_PLAY_DUR, gridDur) + RELEASE_TAIL;
    const vel = Math.max(0.05, Math.min(1, 0.75 * velScale));

    const sources = scheduleChord(
      ctx,
      master,
      this.instrument,
      midis,
      t0,
      playDur,
      vel
    );
    this.scheduled.push(...sources);
  }

  private scheduleFrom(fromSec: number) {
    const endTime = this.duration + 0.1;
    const mode = this.previewMode;
    const playMelody = mode === "melody" || mode === "both";
    const playChords = mode === "chords" || mode === "both";
    const chordVelScale = mode === "both" ? CHORD_VEL_SCALE : 1;

    if (playMelody) {
      for (const note of this.notes) {
        if (note.end <= fromSec) continue;
        const offset = Math.max(0, (note.start - fromSec) / this.rate);
        if (fromSec + offset * this.rate >= endTime) break;
        this.scheduleNote(note, offset);
      }
    }

    if (playChords) {
      for (const chord of this.chords) {
        if (chord.end <= fromSec) continue;
        const offset = Math.max(0, (chord.start - fromSec) / this.rate);
        if (fromSec + offset * this.rate >= endTime) break;
        this.scheduleChordEvent(chord, offset, chordVelScale);
      }
    }
  }

  async play(fromSec = 0) {
    if (!this.hasPreviewContent()) return;
    const gen = this.generation;
    await this.ensureContext();
    if (gen !== this.generation || !this.hasPreviewContent()) return;

    this.clearScheduled();

    const t = Math.max(0, Math.min(fromSec, this.duration));
    this.startSongTime = t;
    this.startCtxTime = this.ctx!.currentTime;
    this.playing = true;
    this.scheduleFrom(t);
    this.scheduleEnd(t, gen);
  }

  pause() {
    if (!this.playing) return;
    this.bumpGeneration();
    this.startSongTime = this.currentTime;
    this.playing = false;
    this.clearScheduled();
  }

  seek(sec: number) {
    const t = Math.max(0, Math.min(sec, this.duration));
    const wasPlaying = this.playing;
    this.pause();
    this.startSongTime = t;
    if (wasPlaying) {
      void this.play(t);
    }
  }

  stop() {
    this.bumpGeneration();
    this.playing = false;
    this.startSongTime = 0;
    this.clearScheduled();
  }

  unload() {
    this.stop();
    this.notes = [];
    this.chords = [];
    this.duration = 0;
    this.previewMode = "melody";
  }

  dispose() {
    this.unload();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }
}
