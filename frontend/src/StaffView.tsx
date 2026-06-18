import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
}

export interface StaffViewHandle {
  exportPng: (name?: string) => void;
}

const PAPER = "#fbf7ef";

function noteIndexForTime(notes: Note[], t: number): number {
  if (!notes.length) return -1;
  let idx = -1;
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].start <= t + 1e-3) idx = i;
    else break;
  }
  return idx;
}

function syncCursor(
  osmd: OpenSheetMusicDisplay,
  notes: Note[],
  tempo: number,
  t: number
): void {
  if (!osmd?.cursor) return;
  osmd.cursor.show();
  osmd.cursor.reset();

  if (notes.length) {
    const idx = noteIndexForTime(notes, t);
    for (let i = 0; i < idx; i++) {
      osmd.cursor.next();
    }
    osmd.cursor.update();
    return;
  }

  const beat = 60 / Math.max(tempo, 1);
  const measureDur = beat * 4;
  const measures = Math.floor(t / measureDur);
  for (let i = 0; i < measures; i++) {
    osmd.cursor.nextMeasure();
  }
  osmd.cursor.update();
}

const StaffView = forwardRef<StaffViewHandle, Props>(function StaffView(
  { musicxml, notes, tempo, currentTime = 0, filename },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
        syncCursor(osmd, notes, tempo, currentTime);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "五线谱加载失败");
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
    syncCursor(osmd, notes, tempo, currentTime);
  }, [currentTime, notes, tempo, ready]);

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
    return <div className="warn">无五线谱内容。</div>;
  }

  return (
    <div className="staff-wrap">
      {loadError && <div className="warn">⚠ {loadError}</div>}
      <div
        ref={containerRef}
        className="staff-osmd"
        aria-label={
          filename
            ? `${filename.replace(/\.[^.]+$/, "")} 五线谱`
            : "五线谱"
        }
      />
      {!ready && !loadError && (
        <p className="staff-loading">正在渲染五线谱…</p>
      )}
    </div>
  );
});

export default StaffView;
