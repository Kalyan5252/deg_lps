"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "@/components/Markdown";
import { useMentorChat } from "@/components/MentorChatProvider";
import type { AgentStep } from "@/lib/api";

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
                {m.steps && m.steps.length > 0 && (
                  <AgentActivity steps={m.steps} streaming={streaming} />
                )}
                {m.content ? (
                  <div className="relative">
                    <Markdown>{m.content}</Markdown>
                    {streaming && (
                      <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-ink align-middle" />
                    )}
                  </div>
                ) : (
                  !(m.steps && m.steps.length > 0 && streaming) && (
                    <div className="flex items-center gap-1 py-0.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.2s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub [animation-delay:-0.1s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sub" />
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Codex-style activity feed: the actions the agent takes during a turn
   (ran a query, set a challenge, …) as a collapsible group; while streaming
   the current action stays visible with a spinner (issue #23 bug 2b). ---- */

function StepIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "running")
    return (
      <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line border-t-accent" />
    );
  if (status === "ok")
    return <span className="w-3 shrink-0 text-center text-ok">✓</span>;
  return <span className="w-3 shrink-0 text-center text-warn">!</span>;
}

function StepRow({ step }: { step: AgentStep }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="text-xs">
      <button
        onClick={() => step.detail && setShowDetail((s) => !s)}
        className={`flex w-full items-center gap-2 py-1 text-left ${
          step.detail ? "cursor-pointer hover:text-ink" : "cursor-default"
        } ${step.status === "running" ? "text-ink" : "text-sub"}`}
      >
        <StepIcon status={step.status} />
        <span className="min-w-0 flex-1 truncate">{step.label}</span>
        {step.detail && (
          <span
            className={`text-[10px] text-sub transition-transform ${
              showDetail ? "rotate-90" : ""
            }`}
          >
            ▸
          </span>
        )}
      </button>
      {showDetail && step.detail && (
        <pre className="mb-1 ml-5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-canvas px-2 py-1.5 font-mono text-[11px] text-sub">
          {step.detail}
        </pre>
      )}
    </div>
  );
}

function AgentActivity({
  steps,
  streaming,
}: {
  steps: AgentStep[];
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  const running = steps.filter((s) => s.status === "running");
  const done = steps.length - running.length;

  // While the turn streams, show every step live; afterwards collapse into a
  // one-line summary the learner can expand for reference.
  if (streaming || open) {
    return (
      <div className="mb-2 rounded-md border border-line bg-canvas/60 px-2 py-1">
        {!streaming && (
          <button
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-1.5 py-0.5 text-left text-[11px] font-medium uppercase tracking-wide text-sub hover:text-ink"
          >
            <span className="rotate-90 text-[10px]">▸</span> Agent activity
          </button>
        )}
        {steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </div>
    );
  }
  return (
    <button
      onClick={() => setOpen(true)}
      className="mb-2 flex items-center gap-1.5 rounded-md border border-line bg-canvas/60 px-2 py-1 text-[11px] text-sub hover:text-ink"
    >
      <span className="text-[10px]">▸</span>
      {done === 1 ? "1 action taken" : `${done} actions taken`}
    </button>
  );
}
