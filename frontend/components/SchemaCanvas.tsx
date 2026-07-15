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

const CARD_MIN = 220;
const CARD_MAX = 460;
const HEAD_H = 34;
const ROW_H = 22;

// Size each card to fit its widest content (table name + "rows" badge, and the
// longest "column  TYPE" row), clamped so it never gets absurdly wide/narrow.
function cardWidth(t: Table): number {
  // header: name (mono 13px semibold) + "<rows> rows" badge + padding/gap
  const badge = (String(t.row_count).length + 5) * 6.0;
  const title = t.name.length * 8.4 + badge + 40;
  // rows: column name (mono 12px) + TYPE label + padding
  let cols = 0;
  for (const c of t.columns) {
    cols = Math.max(cols, c.name.length * 7.6 + c.type.length * 6.2 + 48);
  }
  return Math.max(CARD_MIN, Math.min(CARD_MAX, Math.ceil(Math.max(title, cols))));
}

// Professional layered ER layout: rank tables by their foreign-key depth
// (pure lookup/parent tables on the left, tables that reference them flowing
// right), then stack each rank in its own column. No overlap, relations read
// left-to-right — so users don't have to hand-arrange every schema.
function layout(
  tables: Table[],
  relations: Relation[] = []
): Record<string, { x: number; y: number }> {
  const X0 = 40;
  const Y0 = 32;
  const H_GAP = 90; // horizontal gap between columns
  const V_GAP = 36; // vertical gap between stacked cards

  const byName = new Set(tables.map((t) => t.name));
  const refs: Record<string, Set<string>> = {};
  tables.forEach((t) => (refs[t.name] = new Set()));
  relations.forEach((r) => {
    if (
      byName.has(r.from_table) &&
      byName.has(r.to_table) &&
      r.from_table !== r.to_table
    ) {
      refs[r.from_table].add(r.to_table); // child references parent
    }
  });

  // depth = 1 + max depth of the parents it references (cycle-safe)
  const level: Record<string, number> = {};
  const visiting = new Set<string>();
  const depth = (name: string): number => {
    if (level[name] !== undefined) return level[name];
    if (visiting.has(name)) return 0; // break any relation cycle
    visiting.add(name);
    let m = -1;
    refs[name].forEach((p) => (m = Math.max(m, depth(p))));
    visiting.delete(name);
    return (level[name] = m + 1);
  };
  tables.forEach((t) => depth(t.name));

  // group tables by column (level)
  const cols: Record<number, Table[]> = {};
  tables.forEach((t) => (cols[level[t.name]] ||= []).push(t));

  const cardH = (t: Table) => HEAD_H + t.columns.length * ROW_H + 6;
  const pos: Record<string, { x: number; y: number }> = {};
  let x = X0;
  Object.keys(cols)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((lv) => {
      const group = cols[lv].slice().sort((a, b) => a.name.localeCompare(b.name));
      let y = Y0;
      let colW = 0;
      group.forEach((t) => {
        pos[t.name] = { x, y };
        y += cardH(t) + V_GAP;
        colW = Math.max(colW, cardWidth(t));
      });
      x += colW + H_GAP;
    });
  return pos;
}

export default function SchemaCanvas({
  tables,
  relations,
  storageKey,
  extraHint,
}: {
  tables: Table[];
  relations: Relation[];
  storageKey: string;
  /** optional extra text for the help pill (e.g. an expand shortcut) */
  extraHint?: string;
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

  // visible canvas size (for the mini-map viewport rectangle)
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setViewSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    const base = layout(tables, relations);
    setPos(saved ? { ...base, ...saved } : base);
    // restore last pan/zoom so switching tabs keeps the view where you left it
    try {
      const v = JSON.parse(localStorage.getItem(`${storageKey}:view`) || "null");
      if (v) {
        if (v.pan) setPan(v.pan);
        if (typeof v.zoom === "number") setZoom(v.zoom);
      }
    } catch {
      /* noop */
    }
  }, [tables, relations, storageKey]);

  useEffect(() => {
    if (Object.keys(pos).length) {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    }
  }, [pos, storageKey]);

  // persist the viewport (pan + zoom) too, so it survives a full reload. Skip
  // the first run so the initial default {0,0}/1 doesn't clobber a saved view
  // before the restore above has committed.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    localStorage.setItem(`${storageKey}:view`, JSON.stringify({ pan, zoom }));
  }, [pan, zoom, storageKey]);

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
        const fromRight = pos[ft.name].x + cardWidth(ft);
        const fromLeft = pos[ft.name].x;
        const toRight = pos[tt.name].x + cardWidth(tt);
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

  // ---- mini-map (VS Code style): a scaled-down world with a draggable
  // viewport rectangle, so large schemas are easy to navigate ----
  const MM_W = 176;
  const MM_H = 120;
  const MM_PAD = 8;
  const mini = useMemo(() => {
    const names = tables.filter((t) => pos[t.name]);
    if (!names.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of names) {
      const p = pos[t.name];
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + cardWidth(t));
      y1 = Math.max(y1, p.y + cardHeight(t));
    }
    // include the current viewport in the bounds so the rect never clips away
    if (viewSize.w && zoom) {
      x0 = Math.min(x0, -pan.x / zoom);
      y0 = Math.min(y0, -pan.y / zoom);
      x1 = Math.max(x1, (-pan.x + viewSize.w) / zoom);
      y1 = Math.max(y1, (-pan.y + viewSize.h) / zoom);
    }
    const bw = Math.max(1, x1 - x0);
    const bh = Math.max(1, y1 - y0);
    const k = Math.min((MM_W - MM_PAD * 2) / bw, (MM_H - MM_PAD * 2) / bh);
    // center the world inside the mini-map box
    const ox = MM_PAD + (MM_W - MM_PAD * 2 - bw * k) / 2;
    const oy = MM_PAD + (MM_H - MM_PAD * 2 - bh * k) / 2;
    const toMini = (wx: number, wy: number) => ({
      x: ox + (wx - x0) * k,
      y: oy + (wy - y0) * k,
    });
    return { k, x0, y0, ox, oy, toMini };
  }, [tables, pos, pan, zoom, viewSize]);

  const miniDrag = useRef(false);
  function miniNavigate(e: React.PointerEvent<SVGSVGElement>) {
    if (!mini || !viewSize.w) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // mini-map point -> world point, then center the viewport on it
    const wx = mini.x0 + (mx - mini.ox) / mini.k;
    const wy = mini.y0 + (my - mini.oy) / mini.k;
    setSmooth(false);
    setPan({ x: viewSize.w / 2 - wx * zoom, y: viewSize.h / 2 - wy * zoom });
  }

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
            setPos(layout(tables, relations));
          }}
          title="Auto-arrange tables & reset view"
        >
          Arrange
        </button>
      </div>

      <div
        className="absolute left-2 top-3 z-20 rounded bg-white/80 px-2 py-1 text-[11px] text-sub"
        style={{ pointerEvents: "none" }}
      >
        Drag tables to arrange · drag canvas to pan · scroll to zoom
        {extraHint ? ` · ${extraHint}` : ""}
      </div>

      {/* mini-map */}
      {mini && (
        <svg
          width={MM_W}
          height={MM_H}
          className="absolute bottom-3 right-3 z-20 rounded-md border border-line bg-white/90 shadow-sm"
          style={{ cursor: "pointer", touchAction: "none" }}
          onPointerDown={(e) => {
            e.stopPropagation();
            miniDrag.current = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* capture is best-effort (keeps drag alive outside the box) */
            }
            miniNavigate(e);
          }}
          onPointerMove={(e) => {
            if (miniDrag.current) miniNavigate(e);
          }}
          onPointerUp={() => {
            miniDrag.current = false;
          }}
        >
          <title>Mini-map — click or drag to navigate</title>
          {tables.map((t) => {
            const p = pos[t.name];
            if (!p) return null;
            const a = mini.toMini(p.x, p.y);
            return (
              <rect
                key={t.name}
                x={a.x}
                y={a.y}
                width={Math.max(3, cardWidth(t) * mini.k)}
                height={Math.max(2, cardHeight(t) * mini.k)}
                rx={1.5}
                fill="#c7cdd9"
              />
            );
          })}
          {viewSize.w > 0 && (
            (() => {
              const a = mini.toMini(-pan.x / zoom, -pan.y / zoom);
              return (
                <rect
                  x={a.x}
                  y={a.y}
                  width={(viewSize.w / zoom) * mini.k}
                  height={(viewSize.h / zoom) * mini.k}
                  rx={2}
                  fill="rgba(47, 109, 246, 0.08)"
                  stroke="#2f6df6"
                  strokeWidth={1.2}
                />
              );
            })()
          )}
        </svg>
      )}

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
                width: cardWidth(t),
                cursor: "grab",
              }}
            >
              <div className="flex items-center justify-between gap-2 rounded-t-lg border-b border-line bg-ink px-3 text-white" style={{ height: HEAD_H }}>
                <span className="min-w-0 truncate font-mono text-[13px] font-semibold">
                  {t.name}
                </span>
                <span className="shrink-0 whitespace-nowrap text-[10px] text-white/60">
                  {t.row_count} rows
                </span>
              </div>
              {t.columns.map((c) => (
                <div
                  key={c.name}
                  className="flex items-center justify-between gap-2 px-3 text-[12px]"
                  style={{ height: ROW_H }}
                >
                  <span className="flex min-w-0 items-center gap-1 font-mono">
                    {c.pk && (
                      <span className="shrink-0 text-warn" title="primary key">
                        ★
                      </span>
                    )}
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="shrink-0 text-[10px] uppercase text-sub">
                    {c.type}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
