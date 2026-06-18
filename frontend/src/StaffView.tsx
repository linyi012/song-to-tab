import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { OpenSheetMusicDisplay, CursorType } from "opensheetmusicdisplay";
import type { Note } from "./api";

interface Props {
  musicxml: string;
  notes: Note[];
  tempo: number;
  duration: number;
  currentTime?: number;
  filename?: string;
  label?: string;
  loadingLabel?: string;
}

export interface StaffViewHandle {
  exportPng: (name?: string) => void;
}

const PAPER = "#fbf7ef";

export function noteIndexForTime(notes: Note[], t: number): number {
  if (!notes.length) return -1;
  let idx = -1;
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].start <= t + 1e-3) idx = i;
    else break;
  }
  return idx;
}

function cursorSyncKey(notes: Note[], tempo: number, t: number): string {
  if (notes.length) return `n:${noteIndexForTime(notes, t)}`;
  const beat = 60 / Math.max(tempo, 1);
  return `m:${Math.floor(t / (beat * 4))}`;
}

function measureIndexForTime(tempo: number, t: number): number {
  const beat = 60 / Math.max(tempo, 1);
  return Math.floor(t / (beat * 4));
}

function syncCursorIncremental(
  osmd: OpenSheetMusicDisplay,
  newIdx: number,
  lastIdxRef: MutableRefObject<number>
): void {
  if (!osmd?.cursor) return;

  const lastIdx = lastIdxRef.current;
  if (newIdx === lastIdx) return;

  const cursor = osmd.cursor;
  const isSeek = newIdx < lastIdx || lastIdx < 0;

  if (isSeek) {
    cursor.hide();
    cursor.reset();
    for (let i = 0; i < newIdx; i++) {
      cursor.next();
    }
    cursor.show();
  } else {
    for (let i = lastIdx; i < newIdx; i++) {
      cursor.next();
    }
  }

  cursor.update();
  lastIdxRef.current = newIdx;
}

function syncCursorByMeasure(
  osmd: OpenSheetMusicDisplay,
  newMeasure: number,
  lastMeasureRef: MutableRefObject<number>
): void {
  if (!osmd?.cursor) return;

  const lastMeasure = lastMeasureRef.current;
  if (newMeasure === lastMeasure) return;

  const cursor = osmd.cursor;
  const isSeek = newMeasure < lastMeasure || lastMeasure < 0;

  if (isSeek) {
    cursor.hide();
    cursor.reset();
    for (let i = 0; i < newMeasure; i++) {
      cursor.nextMeasure();
    }
    cursor.show();
  } else {
    for (let i = lastMeasure; i < newMeasure; i++) {
      cursor.nextMeasure();
    }
  }

  cursor.update();
  lastMeasureRef.current = newMeasure;
}

const StaffViewInner = forwardRef<StaffViewHandle, Props>(function StaffView(
  {
    musicxml,
    notes,
    tempo,
    currentTime = 0,
    filename,
    label = "五线谱",
    loadingLabel = "正在渲染五线谱…",
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const lastNoteIdxRef = useRef(-1);
  const lastMeasureRef = useRef(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const cursorKey = useMemo(
    () => cursorSyncKey(notes, tempo, currentTime),
    [notes, tempo, currentTime]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !musicxml) {
      setReady(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoadError(null);
    setReady(false);
    lastNoteIdxRef.current = -1;
    lastMeasureRef.current = -1;

    const osmd = new OpenSheetMusicDisplay(el, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      drawingParameters: "compacttight",
    });
    osmd.setOptions({
      defaultColorMusic: "#1f1a12",
      cursorsOptions: [
        {
          type: CursorType.ThinLeft,
          color: "#ff7a45",
          alpha: 0.35,
          follow: false,
        },
      ],
    });
    osmdRef.current = osmd;

    osmd
      .load(musicxml)
      .then(() => {
        if (cancelled) return;
        osmd.render();
        osmd.enableOrDisableCursors(true);
        osmd.cursor.hide();
        setReady(true);
        if (notes.length) {
          syncCursorIncremental(
            osmd,
            noteIndexForTime(notes, currentTime),
            lastNoteIdxRef
          );
        } else {
          syncCursorByMeasure(
            osmd,
            measureIndexForTime(tempo, currentTime),
            lastMeasureRef
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : `${label}加载失败`);
      });

    return () => {
      cancelled = true;
      osmdRef.current = null;
      el.innerHTML = "";
    };
  }, [musicxml]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !ready) return;
    if (notes.length) {
      const idx = Number(cursorKey.slice(2));
      syncCursorIncremental(osmd, idx, lastNoteIdxRef);
    } else {
      const m = Number(cursorKey.slice(2));
      syncCursorByMeasure(osmd, m, lastMeasureRef);
    }
  }, [cursorKey, ready, notes.length]);

  useImperativeHandle(ref, () => ({
    exportPng: (name?: string) => {
      const el = containerRef.current;
      if (!el) return;
      const svg = el.querySelector("svg");
      if (!svg) return;

      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const bbox = svg.getBoundingClientRect();
      const w = Math.max(bbox.width, 1);
      const h = Math.max(bbox.height, 1);
      clone.setAttribute("width", String(w));
      clone.setAttribute("height", String(h));

      const xml = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([xml], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      const scale = 2;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = w * scale;
        canvas.height = h * scale;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.fillStyle = PAPER;
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0);
        }
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          const base = (name || filename || "staff").replace(/\.[^.]+$/, "");
          a.href = URL.createObjectURL(blob);
          a.download = `${base}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
        }, "image/png");
      };
      img.src = url;
    },
  }));

  if (!musicxml) {
    return <div className="warn">无{label}内容。</div>;
  }

  return (
    <div className="staff-wrap">
      {loadError && <div className="warn">⚠ {loadError}</div>}
      <div
        ref={containerRef}
        className="staff-osmd"
        aria-label={
          filename
            ? `${filename.replace(/\.[^.]+$/, "")} ${label}`
            : label
        }
      />
      {!ready && !loadError && (
        <p className="staff-loading">{loadingLabel}</p>
      )}
    </div>
  );
});

const StaffView = memo(StaffViewInner, (prev, next) => {
  if (prev.musicxml !== next.musicxml) return false;
  if (prev.tempo !== next.tempo) return false;
  if (prev.notes !== next.notes) return false;
  return (
    cursorSyncKey(prev.notes, prev.tempo, prev.currentTime ?? 0) ===
    cursorSyncKey(next.notes, next.tempo, next.currentTime ?? 0)
  );
});

export default StaffView;
