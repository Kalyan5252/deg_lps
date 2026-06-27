"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import Markdown from "@/components/Markdown";
import { useSpeechToText } from "@/lib/useSpeechToText";

type Msg = { role: string; content: string };

const STARTERS = [
  "Explain this dataset to me",
  "How do I write a JOIN here?",
  "What's a GROUP BY and when do I use it?",
];

export default function TrackMentorChat({
  trackId,
  currentSql,
}: {
  trackId: string | number;
  currentSql: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.trackChatThread(trackId).then(setMessages).catch(() => {});
  }, [trackId]);

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
      const { reply } = await api.trackChat(trackId, msg, currentSql);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `_Couldn't reach the mentor: ${e.message}_` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function clearThread() {
    if (!confirm("Clear this conversation?")) return;
    await api.trackChatClear(trackId).catch(() => {});
    setMessages([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-xs font-medium text-sub">
          Ask anything — concepts, your data, SQL help
        </span>
        {messages.length > 0 && (
          <button
            onClick={clearThread}
            className="text-xs text-sub hover:text-bad"
            title="Clear conversation"
          >
            Clear
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="rounded-lg bg-canvas p-3 text-sm text-ink">
              👋 I'm your SQL mentor. Ask me to explain a concept, help with a
              query on <strong>your dataset</strong>, or review your thinking —
              I'll keep it conversational.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="tag hover:bg-white"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent px-3 py-2 text-sm text-white">
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
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <ChatInput value={input} setValue={setInput} onSend={send} busy={busy} />
    </div>
  );
}

function ChatInput({
  value,
  setValue,
  onSend,
  busy,
}: {
  value: string;
  setValue: (v: string) => void;
  onSend: (t: string) => void;
  busy: boolean;
}) {
  // capture what was typed before recording so dictation appends to it
  const baseRef = useRef("");
  const { supported, listening, toggle, stop } = useSpeechToText((text) => {
    setValue((baseRef.current ? baseRef.current + " " : "") + text);
  });

  function onMic() {
    if (!listening) baseRef.current = value.trim();
    toggle();
  }

  function submit(text: string) {
    if (listening) stop(); // don't keep the mic open after sending
    onSend(text);
  }

  return (
    <div className="border-t border-line p-3">
      {listening && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-bad">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-bad/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-bad" />
          </span>
          Listening… speak now, tap the mic to stop
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(value);
            }
          }}
          placeholder="Ask your mentor…  (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex flex-col gap-1.5 self-stretch">
          {supported && (
            <button
              onClick={onMic}
              title={listening ? "Stop dictation" : "Dictate with your voice"}
              className={`flex h-8 w-9 items-center justify-center rounded-md border text-sm transition-colors ${
                listening
                  ? "border-bad bg-bad/10 text-bad"
                  : "border-line text-sub hover:bg-canvas hover:text-ink"
              }`}
            >
              <MicIcon />
            </button>
          )}
          <button
            onClick={() => submit(value)}
            disabled={busy || !value.trim()}
            className="btn btn-primary flex-1"
          >
            Send
          </button>
        </div>
      </div>
    </div>
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
        fill="none"
      />
    </svg>
  );
}
