"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMentorChat } from "@/components/MentorChatProvider";
import { useSpeechToText } from "@/lib/useSpeechToText";

type Pos = { x: number; y: number };
type Size = { w: number; h: number };

const ORB = 54;
const MIN_W = 360;
const MIN_H = 60;
const LS = {
  pos: "sqlforge_fp_pos",
  size: "sqlforge_fp_size",
  locked: "sqlforge_fp_locked",
};

export default function FloatingPrompt() {
  const { send, busy, trackId } = useMentorChat();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [size, setSize] = useState<Size>({ w: 540, h: 64 });
  const [locked, setLocked] = useState(false);
  const [resizable, setResizable] = useState(true);
  const [menu, setMenu] = useState<Pos | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [input, setInput] = useState("");
  // while a drag/resize gesture is active we disable the morph transition so the
  // panel tracks the cursor 1:1 instead of easing 0.5s behind it (the lag).
  const [dragging, setDragging] = useState(false);

  const gesture = useRef<any>(null);
  const baseRef = useRef("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { supported: micSupported, listening, toggle: toggleVoice, stop: stopVoice } =
    useSpeechToText((t) => setInput((baseRef.current ? baseRef.current + " " : "") + t));

  // ---- init ----
  useEffect(() => {
    setMounted(true);
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const j = (k: string) => {
      try {
        return JSON.parse(localStorage.getItem(k) || "null");
      } catch {
        return null;
      }
    };
    const sz = j(LS.size);
    if (sz) setSize(sz);
    const w = (sz?.w as number) || 540;
    const h = (sz?.h as number) || 64;
    const p = j(LS.pos) || {
      x: Math.round((window.innerWidth - w) / 2),
      y: window.innerHeight - h - 96,
    };
    setPos({
      x: Math.min(Math.max(8, p.x), window.innerWidth - 80),
      y: Math.min(Math.max(8, p.y), window.innerHeight - 60),
    });
    setLocked(localStorage.getItem(LS.locked) === "1");
  }, []);

  useEffect(() => {
    const onResize = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight });
      setPos((p) => ({
        x: Math.min(Math.max(8, p.x), window.innerWidth - 80),
        y: Math.min(Math.max(8, p.y), window.innerHeight - 60),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (mounted) localStorage.setItem(LS.pos, JSON.stringify(pos));
  }, [pos, mounted]);
  useEffect(() => {
    if (mounted) localStorage.setItem(LS.size, JSON.stringify(size));
  }, [size, mounted]);

  // focus the input when the bar opens
  useEffect(() => {
    if (open) setTimeout(() => taRef.current?.focus(), 260);
  }, [open]);

  // ---- shortcuts ----
  function onMic() {
    if (!listening) baseRef.current = input.trim();
    toggleVoice();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (open && mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        onMic();
      } else if (e.key === "Escape") {
        if (menu) setMenu(null);
        else if (showShortcuts) setShowShortcuts(false);
        else if (open) setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, menu, showShortcuts, listening, input]);

  // ---- drag & resize ----
  function startDrag(e: React.PointerEvent) {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    gesture.current = { mode: "drag", sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    attach();
  }
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    gesture.current = { mode: "resize", sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h };
    attach();
  }
  function attach() {
    setDragging(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.userSelect = "none";
  }
  const onMove = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "drag") {
      setPos({
        x: Math.min(Math.max(8, g.ox + (e.clientX - g.sx)), window.innerWidth - 60),
        y: Math.min(Math.max(8, g.oy + (e.clientY - g.sy)), window.innerHeight - 40),
      });
    } else {
      setSize({
        w: Math.max(MIN_W, Math.min(g.ow + (e.clientX - g.sx), window.innerWidth - 40)),
        h: Math.max(MIN_H, Math.min(g.oh + (e.clientY - g.sy), 260)),
      });
    }
  }, []);
  const onUp = useCallback(() => {
    gesture.current = null;
    setDragging(false);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.userSelect = "";
  }, [onMove]);

  async function submit() {
    const text = input.trim();
    if (!text || busy || !trackId) return;
    if (listening) stopVoice();
    setInput("");
    baseRef.current = "";
    await send(text); // message renders in the right-side chat window
  }

  function toggleLock() {
    setLocked((l) => {
      const n = !l;
      localStorage.setItem(LS.locked, n ? "1" : "0");
      return n;
    });
    setMenu(null);
  }

  if (!mounted) return null;

  const active = listening || busy;
  // geometry morphs between the orb (closed) and the bar (open)
  const geom = open
    ? { left: pos.x, top: pos.y, width: size.w, height: size.h, borderRadius: 16 }
    : {
        left: vp.w - ORB - 26,
        top: vp.h - ORB - 26,
        width: ORB,
        height: ORB,
        borderRadius: ORB / 2,
      };

  return (
    <>
      {/* context menu */}
      {menu && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setMenu(null)} />
          <div
            className="fixed z-[71] w-48 overflow-hidden rounded-lg border border-line bg-white py-1 text-sm shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem onClick={toggleLock}>
              {locked ? "🔓  Unlock position" : "🔒  Lock position"}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setResizable((r) => !r);
                setMenu(null);
              }}
            >
              ↔  Resize panel {resizable ? "✓" : ""}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setShowShortcuts(true);
                setMenu(null);
              }}
            >
              ⌨  Shortcuts
            </MenuItem>
          </div>
        </>
      )}

      {/* shortcuts overlay */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="w-80 rounded-xl border border-line bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">Prompt shortcuts</h3>
            <ul className="space-y-2 text-sm">
              {[
                ["Toggle prompt", "⌘ ⇧ K"],
                ["Voice mode", "⌘ ⇧ V"],
                ["Send", "Enter"],
                ["New line", "⇧ Enter"],
                ["Close", "Esc"],
                ["Move / resize", "drag grip / corner"],
                ["Options", "right-click"],
              ].map(([k, v]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className="text-sub">{k}</span>
                  <kbd className="rounded border border-line bg-canvas px-2 py-0.5 font-mono text-xs">
                    {v}
                  </kbd>
                </li>
              ))}
            </ul>
            <button className="btn mt-4 w-full" onClick={() => setShowShortcuts(false)}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* the morphing element */}
      <div
        className={`fp-morph fp-rim ${open ? "fp-glass" : "fp-orb"} ${
          active ? "is-active" : ""
        } fixed z-[60] overflow-hidden text-white ${
          open ? "" : "cursor-pointer transition-transform hover:scale-105"
        }`}
        style={dragging ? { ...geom, transition: "none" } : geom}
        onClick={() => {
          if (!open) setOpen(true);
        }}
        onContextMenu={(e) => {
          if (!open) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* closed: orb spark */}
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity"
          style={{ opacity: open ? 0 : 1 }}
        >
          <SparkIcon />
        </div>

        {/* open: prompt bar (prompt | send | voice) */}
        <div
          className="flex h-full items-center gap-2 px-2.5"
          style={{
            width: size.w,
            opacity: open ? 1 : 0,
            transition: "opacity .25s ease",
            transitionDelay: open ? ".14s" : "0s",
            pointerEvents: open ? "auto" : "none",
          }}
        >
          {/* drag grip */}
          <button
            onPointerDown={startDrag}
            title="Drag"
            className={`flex h-8 w-5 shrink-0 items-center justify-center text-white/45 hover:text-white/80 ${
              locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
            }`}
          >
            <GripIcon />
          </button>

          {/* prompt box */}
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={trackId ? "Ask your mentor…" : "Open a track to chat"}
            disabled={!trackId}
            className="max-h-40 min-h-[36px] flex-1 resize-none rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/45 outline-none focus:border-white/40 disabled:opacity-50"
          />

          {/* submit */}
          <button
            onClick={submit}
            disabled={busy || !input.trim() || !trackId}
            className="h-9 shrink-0 rounded-lg bg-white/90 px-4 text-sm font-medium text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-white/30 disabled:text-white/60"
          >
            {busy ? "…" : "Send"}
          </button>

          {/* voice */}
          {micSupported && (
            <button
              onClick={onMic}
              title={listening ? "Stop voice (⌘⇧V)" : "Voice mode (⌘⇧V)"}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                listening
                  ? "animate-pulse border-red-300 bg-red-400/30 text-red-100"
                  : "border-white/15 bg-white/10 text-white/80 hover:bg-white/20 hover:text-white"
              }`}
            >
              <MicIcon />
            </button>
          )}

          {/* close */}
          <button
            onClick={() => setOpen(false)}
            title="Close (Esc)"
            className="flex h-9 w-7 shrink-0 items-center justify-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>

        {/* resize handle */}
        {open && resizable && !locked && (
          <div
            onPointerDown={startResize}
            title="Drag to resize"
            className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 55%, rgba(255,255,255,.5) 55%, rgba(255,255,255,.5) 65%, transparent 65%, transparent 78%, rgba(255,255,255,.5) 78%, rgba(255,255,255,.5) 88%, transparent 88%)",
            }}
          />
        )}
      </div>
    </>
  );
}

function MenuItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="block w-full px-3 py-2 text-left hover:bg-canvas">
      {children}
    </button>
  );
}

function SparkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z" />
      <circle cx="18.5" cy="17.5" r="1.6" />
      <circle cx="5.5" cy="16.5" r="1.1" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
      {[3, 8, 13].map((y) =>
        [2, 7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />)
      )}
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
