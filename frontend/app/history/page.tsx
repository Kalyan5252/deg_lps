"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function HistoryPage() {
  const [attempts, setAttempts] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api.attempts().then(setAttempts).catch((e) => setErr(e.message));
  }, []);

  return (
    <Shell>
      <PageHeader
        title="Scenario History"
        subtitle="Every solution you submitted for review, with the senior engineer's verdict."
      />
      <div className="px-8 py-6">
        {err && <p className="text-sm text-bad">{err}</p>}
        {attempts.length === 0 && (
          <p className="text-sm text-sub">
            No submissions yet — solve an incident to build your history.
          </p>
        )}
        <div className="space-y-2">
          {attempts.map((a, i) => {
            const fb = a.feedback?.feedback || {};
            const checks = a.feedback?.checks || [];
            return (
              <div key={i} className="card overflow-hidden">
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-canvas"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${
                        a.passed
                          ? "bg-ok/10 text-ok"
                          : "bg-warn/10 text-warn"
                      }`}
                    >
                      {a.score}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{a.title}</span>
                        {a.passed && (
                          <span className="text-xs font-medium text-ok">
                            solved
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-sub">
                        {new Date(a.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <span className="text-sub">{open === i ? "▲" : "▼"}</span>
                </button>
                {open === i && (
                  <div className="space-y-3 border-t border-line px-5 py-4">
                    {fb.summary && <p className="text-sm">{fb.summary}</p>}
                    <div className="space-y-1">
                      {checks.map((c: any, j: number) => (
                        <div key={j} className="flex items-center gap-2 text-sm">
                          <span className={c.passed ? "text-ok" : "text-bad"}>
                            {c.passed ? "✓" : "✕"}
                          </span>
                          <span>{c.label}</span>
                        </div>
                      ))}
                    </div>
                    <pre className="overflow-x-auto rounded-md bg-canvas p-3 font-mono text-xs">
                      {a.sql}
                    </pre>
                    <Link
                      href={`/scenario/${a.scenario_key}`}
                      className="inline-block text-sm font-medium text-accent"
                    >
                      Reopen incident →
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
