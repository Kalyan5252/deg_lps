"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader, Difficulty, StatusPill, SkillBar } from "@/components/ui";
import { api, getUser } from "@/lib/api";

export default function DashboardPage() {
  const [progress, setProgress] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.progress(), api.scenarios()])
      .then(([p, s]) => {
        setProgress(p);
        setScenarios(s);
      })
      .catch((e) => setErr(e.message));
  }, []);

  const user = typeof window !== "undefined" ? getUser() : null;
  const available = scenarios.filter((s) => s.available);
  const solvedKeys = new Set(
    (progress?.scenarios || [])
      .filter((p: any) => p.status === "solved")
      .map((p: any) => p.scenario_key)
  );
  const recommended =
    available.find((s) => !solvedKeys.has(s.key)) || available[0];
  const topSkills = (progress?.skills || []).slice(0, 4);

  return (
    <Shell>
      <PageHeader
        title={`Welcome back, ${user?.display_name || "engineer"}`}
        subtitle="Your shift starts now. Pick up an incident and start investigating."
      />
      <div className="space-y-6 px-8 py-6">
        {err && <p className="text-sm text-bad">{err}</p>}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Incidents resolved", value: progress?.stats?.solved ?? "—" },
            {
              label: "In progress",
              value: progress?.stats?.in_progress ?? "—",
            },
            {
              label: "Queries submitted",
              value: progress?.stats?.total_attempts ?? "—",
            },
            {
              label: "Scenarios live",
              value: progress?.stats?.available ?? "—",
            },
          ].map((s) => (
            <div key={s.label} className="card p-4">
              <div className="text-2xl font-semibold tabular-nums">
                {s.value}
              </div>
              <div className="mt-1 text-sm text-sub">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Recommended */}
          <div className="lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sub">
              Next up for you
            </h2>
            {recommended ? (
              <Link
                href={`/scenario/${recommended.key}`}
                className="card block p-5 transition-colors hover:border-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="tag">{recommended.path}</span>
                  <Difficulty level={recommended.difficulty} />
                </div>
                <h3 className="mt-3 text-base font-semibold">
                  {recommended.title}
                </h3>
                <p className="mt-1 text-sm text-sub">{recommended.summary}</p>
                <div className="mt-4 flex items-center gap-2">
                  {recommended.skills?.slice(0, 4).map((sk: string) => (
                    <span key={sk} className="tag">
                      {sk}
                    </span>
                  ))}
                </div>
              </Link>
            ) : (
              <div className="card p-5 text-sm text-sub">
                Loading scenarios…
              </div>
            )}

            <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-sub">
              All open incidents
            </h2>
            <div className="space-y-2">
              {available.map((s) => {
                const prog = (progress?.scenarios || []).find(
                  (p: any) => p.scenario_key === s.key
                );
                return (
                  <Link
                    key={s.key}
                    href={`/scenario/${s.key}`}
                    className="card flex items-center justify-between p-4 transition-colors hover:border-accent"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{s.title}</span>
                        <StatusPill status={prog?.status} />
                      </div>
                      <p className="mt-0.5 truncate text-sm text-sub">
                        {s.summary}
                      </p>
                    </div>
                    <Difficulty level={s.difficulty} />
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Skills snapshot */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sub">
              Skill confidence
            </h2>
            <div className="card space-y-4 p-5">
              {topSkills.length === 0 && (
                <p className="text-sm text-sub">
                  Solve incidents to build your skill profile.
                </p>
              )}
              {topSkills.map((s: any) => (
                <SkillBar
                  key={s.skill}
                  skill={s.skill}
                  confidence={s.confidence}
                />
              ))}
              <Link
                href="/progress"
                className="block pt-1 text-sm font-medium text-accent"
              >
                View full progress →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
