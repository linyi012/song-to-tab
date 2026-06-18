import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import type { Chord, Note } from "./api";

interface Props {
  notes: Note[];
  chords: Chord[];
  tuning: string[]; // ["E","A","D","G","B","E"] 低->高
  duration: number;
  tempo: number;
  filename?: string;
  currentTime?: number;
  activeNotes?: Set<number>;
  activeChords?: Set<number>;
}

export interface TabViewHandle {
  exportPng: (name?: string, opts?: { chordsOnly?: boolean }) => void;
}

const PX_PER_SEC = 96;
const ROW_WIDTH = 960;
const LEFT_PAD = 58;
const RIGHT_PAD = 16;
const STRING_GAP = 18;
const STAFF_TOP_PAD = 30; // 给和弦标注留空间
const STAFF_BOTTOM_PAD = 22;
const ROW_GAP = 26;
const TITLE_H = 52;

// 经典纸面配色（与应用深色主题独立，便于导出/打印）
const C = {
  paper: "#fbf7ef",
  frame: "#e4dccb",
  staff: "#4a4338",
  staffSoft: "#6f665741",
  bar: "#2b251c",
  beat: "#d9cfba",
  ink: "#1f1a12",
  muted: "#8c8270",
  accent: "#b4531f",
  title: "#2b251c",
};

// 顶 -> 底 显示顺序：高音 e 弦在最上面
const DISPLAY_LABELS = ["e", "B", "G", "D", "A", "E"];
const SERIF = "Georgia, 'Times New Roman', 'Songti SC', serif";

const TabView = forwardRef<TabViewHandle, Props>(function TabView(
  { notes, chords, duration, tempo, filename, currentTime = 0, activeNotes, activeChords },
  ref
) {
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => {
    const usablePx = ROW_WIDTH - LEFT_PAD - RIGHT_PAD;
    const usableTime = usablePx / PX_PER_SEC;
    const totalTime = Math.max(duration, 1);
    const rows = Math.max(1, Math.ceil(totalTime / usableTime));
    const staffHeight = STAFF_TOP_PAD + STRING_GAP * 5 + STAFF_BOTTOM_PAD;

    const beat = 60 / Math.max(tempo, 1);
    const measureDur = beat * 4; // 4/4

    return { usablePx, usableTime, rows, staffHeight, beat, measureDur };
  }, [duration, tempo]);

  const rowTopOf = (row: number) =>
    TITLE_H + row * (layout.staffHeight + ROW_GAP);

  const stringY = (rowTop: number, displayRow: number) =>
    rowTop + STAFF_TOP_PAD + displayRow * STRING_GAP;

  const placeX = (t: number) => {
    const row = Math.min(
      layout.rows - 1,
      Math.floor(t / layout.usableTime)
    );
    const localX = LEFT_PAD + (t - row * layout.usableTime) * PX_PER_SEC;
    return { row, x: localX };
  };

  const height = rowTopOf(layout.rows) + 8;
  const playPos = placeX(currentTime);
  const playRowTop = rowTopOf(playPos.row);
  const playTopY = stringY(playRowTop, 0);
  const playBottomY = stringY(playRowTop, 5);

  // 每行的小节竖线 / 拍子刻度 / 小节号
  const gridMarks = useMemo(() => {
    const bars: { row: number; x: number; measure: number }[] = [];
    const beats: { row: number; x: number }[] = [];
    const totalTime = layout.rows * layout.usableTime;

    let m = 0;
    for (let t = 0; t <= totalTime + 1e-6; t += layout.measureDur) {
      const { row, x } = placeX(t);
      bars.push({ row, x, measure: m + 1 });
      m += 1;
      if (m > 2000) break;
    }
    let b = 0;
    for (let t = 0; t <= totalTime + 1e-6; t += layout.beat) {
      const { row, x } = placeX(t);
      beats.push({ row, x });
      b += 1;
      if (b > 8000) break;
    }
    return { bars, beats };
  }, [layout]);

  useImperativeHandle(ref, () => ({
    exportPng: (name?: string, opts?: { chordsOnly?: boolean }) => {
      const svg = svgRef.current;
      if (!svg) return;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      if (opts?.chordsOnly) {
        clone.querySelector('[data-export-layer="notes"]')?.remove();
      }
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", String(ROW_WIDTH));
      clone.setAttribute("height", String(height));
      const xml = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([xml], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      const scale = 2;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = ROW_WIDTH * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.fillStyle = C.paper;
          ctx.fillRect(0, 0, ROW_WIDTH, height);
          ctx.drawImage(img, 0, 0);
        }
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement("a");
          const base = (name || filename || "tab").replace(/\.[^.]+$/, "");
          a.href = URL.createObjectURL(blob);
          a.download = `${base}${opts?.chordsOnly ? "-chords" : ""}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
        }, "image/png");
      };
      img.src = url;
    },
  }));

  const tuningLabel = "EADGBE";

  return (
    <div className="tab-svg-wrap">
      <svg
        ref={svgRef}
        width={ROW_WIDTH}
        height={height}
        viewBox={`0 0 ${ROW_WIDTH} ${height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 纸面背景 */}
        <rect x={0} y={0} width={ROW_WIDTH} height={height} fill={C.paper} />

        {/* 标题栏 */}
        <text
          x={LEFT_PAD}
          y={26}
          fill={C.title}
          fontSize={18}
          fontWeight={700}
          fontFamily={SERIF}
        >
          {filename ? filename.replace(/\.[^.]+$/, "") : "Guitar Tab"}
        </text>
        <text
          x={LEFT_PAD}
          y={44}
          fill={C.muted}
          fontSize={12}
          fontFamily={SERIF}
        >
          {`Tempo ≈ ${Math.round(tempo)} BPM    4/4    Tuning ${tuningLabel}`}
        </text>
        <line
          x1={LEFT_PAD}
          y1={TITLE_H - 4}
          x2={ROW_WIDTH - RIGHT_PAD}
          y2={TITLE_H - 4}
          stroke={C.frame}
          strokeWidth={1}
        />

        {/* 每行谱表 */}
        {Array.from({ length: layout.rows }).map((_, row) => {
          const rowTop = rowTopOf(row);
          const topY = stringY(rowTop, 0);
          const bottomY = stringY(rowTop, 5);
          return (
            <g key={`staff-${row}`}>
              {/* 六根弦线 + 弦名 */}
              {DISPLAY_LABELS.map((label, di) => {
                const y = stringY(rowTop, di);
                return (
                  <g key={`s-${row}-${di}`}>
                    <line
                      x1={LEFT_PAD}
                      y1={y}
                      x2={ROW_WIDTH - RIGHT_PAD}
                      y2={y}
                      stroke={C.staff}
                      strokeWidth={0.9}
                    />
                    <text
                      x={LEFT_PAD - 14}
                      y={y + 4}
                      fill={C.muted}
                      fontSize={11}
                      fontFamily={SERIF}
                      fontStyle="italic"
                      textAnchor="middle"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* 左端竖线 + 纵向 TAB 字样 */}
              <line
                x1={LEFT_PAD}
                y1={topY}
                x2={LEFT_PAD}
                y2={bottomY}
                stroke={C.bar}
                strokeWidth={1.6}
              />
              {["T", "A", "B"].map((c, i) => (
                <text
                  key={`tab-${row}-${i}`}
                  x={14}
                  y={topY + 6 + i * ((bottomY - topY) / 2.4)}
                  fill={C.muted}
                  fontSize={15}
                  fontWeight={700}
                  fontFamily={SERIF}
                >
                  {c}
                </text>
              ))}

              {/* 拍子刻度（浅） */}
              {gridMarks.beats
                .filter((bk) => bk.row === row)
                .map((bk, i) => (
                  <line
                    key={`beat-${row}-${i}`}
                    x1={bk.x}
                    y1={topY}
                    x2={bk.x}
                    y2={bottomY}
                    stroke={C.beat}
                    strokeWidth={0.8}
                  />
                ))}

              {/* 小节竖线 + 小节号 */}
              {gridMarks.bars
                .filter((br) => br.row === row && br.x <= ROW_WIDTH - RIGHT_PAD)
                .map((br, i) => (
                  <g key={`bar-${row}-${i}`}>
                    <line
                      x1={br.x}
                      y1={topY}
                      x2={br.x}
                      y2={bottomY}
                      stroke={C.bar}
                      strokeWidth={1.2}
                    />
                    <text
                      x={br.x + 3}
                      y={topY - 14}
                      fill={C.muted}
                      fontSize={9}
                      fontFamily={SERIF}
                    >
                      {br.measure}
                    </text>
                  </g>
                ))}

              {/* 右端竖线 */}
              <line
                x1={ROW_WIDTH - RIGHT_PAD}
                y1={topY}
                x2={ROW_WIDTH - RIGHT_PAD}
                y2={bottomY}
                stroke={C.bar}
                strokeWidth={1.2}
              />
            </g>
          );
        })}

        {/* 播放游标 */}
        <line
          className="playhead"
          x1={playPos.x}
          y1={playTopY - 6}
          x2={playPos.x}
          y2={playBottomY + 6}
          stroke="#ff7a45"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.9}
        />

        {/* 和弦标注 */}
        {chords.map((ch, i) => {
          const { row, x } = placeX(ch.start);
          const rowTop = rowTopOf(row);
          const active = activeChords?.has(i);
          return (
            <g key={`ch-${i}`}>
              {active ? (
                <rect
                  x={x - 4}
                  y={rowTop + 4}
                  width={ch.name.length * 8 + 8}
                  height={18}
                  rx={3}
                  fill="#ff7a45"
                  stroke="#b4531f"
                  strokeWidth={1.5}
                />
              ) : null}
              <text
                x={x}
                y={rowTop + 16}
                fill={active ? "#fff" : C.accent}
                fontSize={13}
                fontWeight={700}
                fontFamily={SERIF}
              >
                {ch.name}
              </text>
            </g>
          );
        })}

        {/* 音符品格数字 */}
        <g data-export-layer="notes">
          {notes.map((n, i) => {
            const { row, x } = placeX(n.start);
            const rowTop = rowTopOf(row);
            const displayRow = 5 - n.string; // 高音弦在顶部
            const y = stringY(rowTop, displayRow);
            const label = String(n.fret);
            const w = label.length * 8 + 6;
            const active = activeNotes?.has(i);
            return (
              <g key={`n-${i}`}>
                <rect
                  x={x - w / 2}
                  y={y - 9}
                  width={w}
                  height={18}
                  rx={3}
                  fill={active ? "#ff7a45" : C.paper}
                  stroke={active ? "#b4531f" : "none"}
                  strokeWidth={active ? 1.5 : 0}
                />
                <text
                  x={x}
                  y={y + 4}
                  fill={active ? "#fff" : C.ink}
                  fontSize={13}
                  fontWeight={700}
                  fontFamily={SERIF}
                  textAnchor="middle"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
});

export default TabView;
