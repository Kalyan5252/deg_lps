"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken } from "@/lib/api";
import Markdown from "@/components/Markdown";
import { useSpeechToText } from "@/lib/useSpeechToText";

type Msg = { role: string; content: string };
type Pos = { x: number; y: number };
type Size = { w: number; h: number };

const MIN_W = 340;
const MIN_H = 260;
const LS = {
  pos: "sqlforge_fm_pos",
  size: "sqlforge_fm_size",
  locked: "sqlforge_fm_locked",
};

function useTrackId(): string | null {
  const path = usePathname();
  const m = path?.match(/^\/tracks\/(\d+)/);
  return m ? m[1] : null;
}

export default function FloatingMentor() {
  const trackId = useTrackId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [size, setSize] = useState<Size>({ w: 460, h: 380 });
  const [locked, setLocked] = useState(false);
  const [resizable, setResizable] = useState(true);
  const [menu, setMenu] = useState<Pos | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const convRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<any>(null);
  const baseRef = useRef("");

  const { supported: micSupported, listening, toggle: toggleVoice, stop: stopVoice } =
    useSpeechToText((t) => setInput((baseRef.current ? baseRef.current + " " : "") + t));

  // ---- init from storage / default placement ----
  useEffect(() => {
    setMounted(true);
    const num = (k: string) => {
      try {
        return JSON.parse(localStorage.getItem(k) || "null");
      } catch {
        return null;
      }
    };
    const sz = num(LS.size);
    if (sz) setSize(sz);
    const p = num(LS.pos);
    const w = (sz?.w as number) || 460;
    const h = (sz?.h as number) || 380;
    const def = {
      x: Math.max(16, Math.round((window.innerWidth - w) / 2)),
      y: 96, // constant top offset — robust regardless of viewport quirks
    };
    // clamp any saved position back into the current viewport so it's never lost
    const raw = p || def;
    setPos({
      x: Math.min(Math.max(8, raw.x), window.innerWidth - 80),
      y: Math.min(Math.max(8, raw.y), window.innerHeight - 60),
    });
    setLocked(localStorage.getItem(LS.locked) === "1");
  }, []);

  // ---- global shortcuts ----
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
  }, [open, menu, showShortcuts, listening]);

  // ---- load conversation when opened ----
  useEffect(() => {
    if (open && trackId && getToken()) {
      api.trackChatThread(trackId).then(setMessages).catch(() => {});
    }
  }, [open, trackId]);

  useEffect(() => {
    // scroll the conversation container only (never the window — the panel is fixed)
    const el = convRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  // ---- drag & resize ----
  function startDrag(e: React.PointerEvent) {
    if (locked) return;
    e.preventDefault();
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
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.userSelect = "none";
  }
  const onMove = useCallback((e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "drag") {
      const w = window.innerWidth, h = window.innerHeight;
      setSize((s) => {
        setPos({
          x: Math.min(Math.max(8, g.ox + (e.clientX - g.sx)), w - 60),
          y: Math.min(Math.max(8, g.oy + (e.clientY - g.sy)), h - 40),
        });
        return s;
      });
    } else {
      setSize({
        w: Math.max(MIN_W, Math.min(g.ow + (e.clientX - g.sx), window.innerWidth - 40)),
        h: Math.max(MIN_H, Math.min(g.oh + (e.clientY - g.sy), window.innerHeight - 40)),
      });
    }
  }, []);
  const onUp = useCallback(() => {
    gesture.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.userSelect = "";
  }, [onMove]);

  // keep the panel inside the viewport if the window resizes
  useEffect(() => {
    const onResize = () =>
      setPos((p) => ({
        x: Math.min(Math.max(8, p.x), window.innerWidth - 80),
        y: Math.min(Math.max(8, p.y), window.innerHeight - 60),
      }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // persist position & size whenever they settle
  useEffect(() => {
    if (mounted) localStorage.setItem(LS.pos, JSON.stringify(pos));
  }, [pos, mounted]);
  useEffect(() => {
    if (mounted) localStorage.setItem(LS.size, JSON.stringify(size));
  }, [size, mounted]);

  // ---- chat ----
  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    if (!trackId) return;
    if (listening) stopVoice();
    setInput("");
    baseRef.current = "";
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setBusy(true);
    try {
      const { reply } = await api.trackChat(trackId, msg);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `_Error: ${e.message}_` }]);
    } finally {
      setBusy(false);
    }
  }

  function onMic() {
    if (!listening) baseRef.current = input.trim();
    toggleVoice();
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

  // ---- launcher (when closed) ----
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Ask the mentor  (⌘⇧K)"
        className="siri-glow fixed bottom-6 right-6 z-[60] flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-ink text-white shadow-lg transition-transform hover:scale-105"
      >
        <SparkIcon />
      </button>
    );
  }

  const active = listening || busy;

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
            <h3 className="mb-3 text-sm font-semibold">Mentor shortcuts</h3>
            <ul className="space-y-2 text-sm">
              {[
                ["Toggle panel", "⌘ ⇧ K"],
                ["Voice mode", "⌘ ⇧ V"],
                ["Send", "Enter"],
                ["New line", "⇧ Enter"],
                ["Close", "Esc"],
                ["Move / resize", "drag header / corner"],
                ["Options", "right-click panel"],
              ].map(([k, v]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className="text-sub">{k}</span>
                  <kbd className="rounded border border-line bg-canvas px-2 py-0.5 font-mono text-xs">
                    {v}
                  </kbd>
                </li>
              ))}
            </ul>
            <button
              className="btn mt-4 w-full"
              onClick={() => setShowShortcuts(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* the floating panel */}
      <div
        className={`siri-glow fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl ${
          active ? "is-active" : ""
        }`}
        style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* header / drag handle */}
        <div
          onPointerDown={startDrag}
          className={`flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 ${
            locked ? "" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-white">
            <SparkIcon small />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-none">AI Mentor</div>
            <div className="mt-0.5 text-[10px] text-sub">
              {listening ? "listening…" : busy ? "thinking…" : "ask me anything"}
            </div>
          </div>
          {locked && <span className="text-xs text-sub" title="position locked">🔒</span>}
          <button
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded text-sub hover:bg-canvas hover:text-ink"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* conversation */}
        <div
          ref={convRef}
          className="min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-3"
        >
          {!trackId && (
            <div className="rounded-lg bg-canvas p-3 text-sm text-sub">
              Open a dataset track to chat about your data.
            </div>
          )}
          {trackId && messages.length === 0 && (
            <div className="rounded-lg bg-canvas p-3 text-sm text-ink">
              ✨ I'm your SQL mentor. Ask me to explain a concept or help with a
              query on <strong>your dataset</strong>.
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent px-3 py-1.5 text-sm text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[92%] rounded-lg border border-line bg-white px-3 py-2">
                  <Markdown>{m.content}</Markdown>
                </div>
              </div>
            )
          )}
          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub" />
              </div>
            </div>
          )}
        </div>

        {/* input row:  prompt box | submit | voice  */}
        <div className="shrink-0 border-t border-line p-2.5">
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={trackId ? "Ask your mentor…" : "Open a track to chat"}
              disabled={!trackId}
              className="max-h-28 min-h-[38px] flex-1 resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-canvas"
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim() || !trackId}
              className="btn btn-primary h-[38px]"
            >
              Send
            </button>
            {micSupported && (
              <button
                onClick={onMic}
                title={listening ? "Stop voice (⌘⇧V)" : "Voice mode (⌘⇧V)"}
                className={`flex h-[38px] w-[38px] items-center justify-center rounded-lg border transition-colors ${
                  listening
                    ? "animate-pulse border-bad bg-bad/10 text-bad"
                    : "border-line text-sub hover:bg-canvas hover:text-ink"
                }`}
              >
                <MicIcon />
              </button>
            )}
          </div>
        </div>

        {/* resize handle */}
        {resizable && !locked && (
          <div
            onPointerDown={startResize}
            title="Drag to resize"
            className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 50%, #c9ccd4 50%, #c9ccd4 60%, transparent 60%, transparent 72%, #c9ccd4 72%, #c9ccd4 82%, transparent 82%)",
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
    <button
      onClick={onClick}
      className="block w-full px-3 py-2 text-left hover:bg-canvas"
    >
      {children}
    </button>
  );
}

function SparkIcon({ small }: { small?: boolean }) {
  const s = small ? 13 : 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z" />
      <circle cx="18.5" cy="17.5" r="1.6" />
      <circle cx="5.5" cy="16.5" r="1.1" />
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
