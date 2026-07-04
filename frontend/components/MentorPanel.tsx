"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Msg = { role: string; content: string };

const PROMPTS = [
  "Where should I start?",
  "What's the execution plan telling me?",
  "Am I on the right track?",
];

export default function MentorPanel({
  scenarioKey,
  currentSql,
  lastResult,
  onClose,
  hideHeader = false,
}: {
  scenarioKey: string;
  currentSql: string;
  lastResult: any;
  onClose?: () => void;
  hideHeader?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.mentorThread(scenarioKey).then(setMessages).catch(() => {});
  }, [scenarioKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setBusy(true);
    try {
      const { reply } = await api.mentor(
        scenarioKey,
        msg,
        currentSql,
        lastResult
      );
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `(mentor unavailable: ${e.message})` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {!hideHeader && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
            AI
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">Senior Mentor</div>
            <div className="mt-0.5 text-xs text-sub">
              Guides, never hands over the answer
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Close mentor panel"
              className="ml-auto flex h-6 w-6 items-center justify-center rounded text-sub hover:bg-canvas hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="rounded-md bg-canvas p-3 text-sm text-sub">
            I'm your on-call lead for this incident. Tell me what you're seeing,
            or ask where to start — I'll point you, but you're driving the query.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${
              m.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-accent text-white"
                  : "border border-line bg-white text-ink"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-sub">
              thinking…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              disabled={busy}
              className="tag hover:bg-white"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask the mentor… (Enter to send)"
            className="flex-1 resize-none rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            className="btn btn-primary self-stretch"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
