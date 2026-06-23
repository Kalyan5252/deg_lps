"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Col = { name: string; type: string; pk: boolean };
type Table = { name: string; columns: Col[]; row_count: number };
type Relation = {
  from_table: string;
  from_col: string;
  to_table: string;
  to_col: string;
};

const CARD_W = 210;
const HEAD_H = 34;
const ROW_H = 22;

function layout(tables: Table[]): Record<string, { x: number; y: number }> {
  // Two-column masonry so cards stay visible even in a narrow panel; users
  // can drag from here to build their own graph view.
  const pos: Record<string, { x: number; y: number }> = {};
  let y = 36;
  tables.forEach((t) => {
    pos[t.name] = { x: 36, y };
    y += HEAD_H + t.columns.length * ROW_H + 6 + 56;
  });
  return pos;
}

export default function SchemaCanvas({
  tables,
  relations,
  storageKey,
}: {
  tables: Table[];
  relations: Relation[];
  storageKey: string;
}) {
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{
    type: "node" | "pan";
    name?: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const [smooth, setSmooth] = useState(false);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  // Smooth, cursor-anchored zoom. The wheel applies a zoom delta proportional to
  // the scroll amount (so trackpads are fine-grained); a short CSS transition on
  // the transform eases each step so even chunky mouse-wheel notches glide. The
  // transition is disabled while dragging so panning stays 1:1.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const z0 = zoomRef.current;
      const p0 = panRef.current;
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= 400;
      const next = Math.min(2, Math.max(0.4, z0 * Math.exp(-d * 0.0015)));
      if (next === z0) return;
      // keep the point under the cursor fixed
      const np = { x: sx - ((sx - p0.x) / z0) * next, y: sy - ((sy - p0.y) / z0) * next };
      zoomRef.current = next;
      panRef.current = np;
      setSmooth(true);
      setZoom(next);
      setPan(np);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    let saved: Record<string, { x: number; y: number }> | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* noop */
    }
    const base = layout(tables);
    setPos(saved ? { ...base, ...saved } : base);
  }, [tables, storageKey]);

  useEffect(() => {
    if (Object.keys(pos).length) {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    }
  }, [pos, storageKey]);

  const cardHeight = (t: Table) => HEAD_H + t.columns.length * ROW_H + 6;

  function onNodeDown(e: React.PointerEvent, name: string) {
    e.stopPropagation();
    setSmooth(false);
    dragRef.current = {
      type: "node",
      name,
      sx: e.clientX,
      sy: e.clientY,
      ox: pos[name]?.x ?? 0,
      oy: pos[name]?.y ?? 0,
    };
  }
  function onPanDown(e: React.PointerEvent) {
    setSmooth(false);
    dragRef.current = {
      type: "pan",
      sx: e.clientX,
      sy: e.clientY,
      ox: pan.x,
      oy: pan.y,
    };
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / zoom;
    const dy = (e.clientY - d.sy) / zoom;
    if (d.type === "node" && d.name) {
      setPos((p) => ({ ...p, [d.name!]: { x: d.ox + dx, y: d.oy + dy } }));
    } else {
      setPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
    }
  }
  function onUp() {
    dragRef.current = null;
  }

  // anchor points for relation edges (right side of child fk -> left of parent)
  const edges = useMemo(() => {
    const tmap = Object.fromEntries(tables.map((t) => [t.name, t]));
    return relations
      .map((r) => {
        const ft = tmap[r.from_table];
        const tt = tmap[r.to_table];
        if (!ft || !tt || !pos[ft.name] || !pos[tt.name]) return null;
        const fIdx = ft.columns.findIndex((c) => c.name === r.from_col);
        const tIdx = tt.columns.findIndex((c) => c.name === r.to_col);
        const fy = pos[ft.name].y + HEAD_H + (Math.max(0, fIdx) + 0.5) * ROW_H;
        const ty = pos[tt.name].y + HEAD_H + (Math.max(0, tIdx) + 0.5) * ROW_H;
        const fromRight = pos[ft.name].x + CARD_W;
        const fromLeft = pos[ft.name].x;
        const toRight = pos[tt.name].x + CARD_W;
        const toLeft = pos[tt.name].x;
        // pick nearest sides
        const useFromRight =
          Math.abs(fromRight - toLeft) < Math.abs(fromLeft - toRight);
        const x1 = useFromRight ? fromRight : fromLeft;
        const x2 = useFromRight ? toLeft : toRight;
        const c = 50;
        return {
          key: `${r.from_table}.${r.from_col}->${r.to_table}`,
          d: `M ${x1} ${fy} C ${x1 + (useFromRight ? c : -c)} ${fy}, ${
            x2 + (useFromRight ? -c : c)
          } ${ty}, ${x2} ${ty}`,
          label: r.from_col,
          lx: (x1 + x2) / 2,
          ly: (fy + ty) / 2,
        };
      })
      .filter(Boolean) as any[];
  }, [relations, pos, tables]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#fafbfc]">
      {/* controls */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-line bg-white p-1 shadow-sm">
        <button
          className="h-6 w-6 rounded text-sub hover:bg-canvas hover:text-ink"
          onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}
          title="Zoom out"
        >
          −
        </button>
        <span className="w-10 text-center text-xs tabular-nums text-sub">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="h-6 w-6 rounded text-sub hover:bg-canvas hover:text-ink"
          onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="ml-1 rounded px-2 text-xs text-sub hover:bg-canvas hover:text-ink"
          onClick={() => {
            setPan({ x: 0, y: 0 });
            setZoom(1);
            setPos(layout(tables));
          }}
          title="Reset view"
        >
          Reset
        </button>
      </div>

      <div
        className="absolute left-2 top-3 z-20 rounded bg-white/80 px-2 py-1 text-[11px] text-sub"
        style={{ pointerEvents: "none" }}
      >
        Drag tables to arrange · drag canvas to pan · scroll to zoom
      </div>

      <div
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={onPanDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        style={{
          backgroundImage:
            "radial-gradient(circle, #e3e5ea 1px, transparent 1px)",
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: "100%",
            height: "100%",
            position: "relative",
            transition: smooth ? "transform 110ms ease-out" : "none",
            willChange: "transform",
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            style={{ width: 1, height: 1 }}
          >
            {edges.map((e) => (
              <g key={e.key}>
                <path d={e.d} fill="none" stroke="#9aa2b1" strokeWidth={1.5} />
                <circle cx={e.lx} cy={e.ly} r={9} fill="#fff" stroke="#e7e8ec" />
                <text
                  x={e.lx}
                  y={e.ly + 3}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#6b7280"
                >
                  FK
                </text>
              </g>
            ))}
          </svg>

          {tables.map((t) => (
            <div
              key={t.name}
              onPointerDown={(e) => onNodeDown(e, t.name)}
              className="absolute select-none rounded-lg border border-line bg-white shadow-sm"
              style={{
                left: pos[t.name]?.x ?? 0,
                top: pos[t.name]?.y ?? 0,
                width: CARD_W,
                cursor: "grab",
              }}
            >
              <div className="flex items-center justify-between rounded-t-lg border-b border-line bg-ink px-3 text-white" style={{ height: HEAD_H }}>
                <span className="truncate font-mono text-[13px] font-semibold">
                  {t.name}
                </span>
                <span className="text-[10px] text-white/60">
                  {t.row_count} rows
                </span>
              </div>
              {t.columns.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center justify-between px-3 text-[12px]"
                  style={{ height: ROW_H }}
                >
                  <span className="flex items-center gap-1 font-mono">
                    {c.pk && (
                      <span className="text-warn" title="primary key">
                        ★
                      </span>
                    )}
                    {c.name}
                  </span>
                  <span className="text-[10px] uppercase text-sub">{c.type}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
