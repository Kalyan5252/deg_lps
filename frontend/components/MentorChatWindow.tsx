"use client";

import { useEffect, useRef } from "react";
import Markdown from "@/components/Markdown";
import { useMentorChat } from "@/components/MentorChatProvider";

export default function MentorChatWindow() {
  const { messages, busy, clear } = useMentorChat();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-xs text-sub">
          Ask with the prompt bar — <kbd className="font-mono">⌘⇧K</kbd>
        </span>
        {messages.length > 0 && (
          <button
            onClick={() => clear()}
            className="text-xs text-sub hover:text-bad"
          >
            Clear
          </button>
        )}
      </div>

      <div ref={ref} className="min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded-lg bg-canvas p-3 text-sm text-ink">
            ✨ Your conversation appears here. Open the prompt bar with{" "}
            <strong>⌘⇧K</strong> (or the orb) and ask anything about your dataset.
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const streaming = m.role === "assistant" && isLast && busy;
          return m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent px-3 py-1.5 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] rounded-lg border border-line bg-white px-3 py-2">
                {m.content ? (
                  <div className="relative">
                    <Markdown>{m.content}</Markdown>
                    {streaming && (
                      <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-ink align-middle" />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 py-0.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
