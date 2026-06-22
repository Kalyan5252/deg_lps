"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader, SkillBar, StatusPill, Difficulty } from "@/components/ui";
import { api } from "@/lib/api";

export default function ProgressPage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.progress().then(setData).catch((e) => setErr(e.message));
  }, []);

  return (
    <Shell>
      <PageHeader
        title="Progress"
        subtitle="Your skill confidence is inferred from how you solve incidents — it adapts every submission."
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-2">
        {err && <p className="text-sm text-bad">{err}</p>}

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sub">
            Skill confidence
          </h2>
          <div className="card space-y-4 p-5">
            {(data?.skills || []).map((s: any) => (
              <SkillBar
                key={s.skill}
                skill={s.skill}
                confidence={s.confidence}
              />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sub">
            Incident log
          </h2>
          <div className="card divide-y divide-line">
            {(data?.scenarios || []).length === 0 && (
              <p className="p-5 text-sm text-sub">
                No incidents attempted yet.
              </p>
            )}
            {(data?.scenarios || []).map((p: any) => (
              <Link
                key={p.scenario_key}
                href={`/scenario/${p.scenario_key}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-canvas"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.title}</span>
                    <StatusPill status={p.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-sub">
                    {p.attempts} attempt{p.attempts === 1 ? "" : "s"} · best{" "}
                    {p.best_score}/100
                  </div>
                </div>
                <Difficulty level={p.difficulty} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
