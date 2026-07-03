"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader, Difficulty, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";

export default function PathsPage() {
  const [paths, setPaths] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.paths().then(setPaths).catch((e) => setErr(e.message));
  }, []);

  return (
    <Shell>
      <PageHeader
        title="Learning Paths"
        subtitle="Each path is a track of escalating incidents. Difficulty adapts as you solve them."
      />
      <div className="space-y-8 px-8 py-6">
        {err && <p className="text-sm text-bad">{err}</p>}
        <section>
          <div className="mb-3">
            <h2 className="text-base font-semibold">Start Here</h2>
            <p className="text-sm text-sub">
              Learn SQL clauses in order, then immediately practice each one on
              a tiny dataset.
            </p>
          </div>
          <Link
            href="/paths/fundamentals-sql"
            className="group relative grid overflow-hidden rounded-lg border border-white/10 bg-[#101217] shadow-xl transition-transform hover:-translate-y-0.5 md:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(47,109,246,0.82),transparent_34%),radial-gradient(circle_at_72%_20%,rgba(168,85,247,0.68),transparent_32%),linear-gradient(135deg,#0b1020_0%,#172033_52%,#07080d_100%)]" />
            <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:34px_34px]" />
            <div className="relative p-6 text-white">
              <div className="flex items-center justify-between">
                <span className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/82">
                  Interactive course
                </span>
                <span className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-xs text-white/72">
                  Beginner
                </span>
              </div>
              <h3 className="mt-8 text-3xl font-semibold leading-tight">
                Fundamentals of SQL
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/68">
                A focused, story-based SQL course. Learn why each clause exists,
                then write the query while the dataset is still in front of you.
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {["SELECT", "WHERE", "ORDER BY", "GROUP BY", "JOINS"].map((sk) => (
                  <span
                    key={sk}
                    className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/72"
                  >
                    {sk}
                  </span>
                ))}
              </div>
              <div className="mt-7 inline-flex rounded-md bg-white px-4 py-2 text-sm font-medium text-ink transition-transform group-hover:translate-x-1">
                Start course →
              </div>
            </div>
            <div className="relative min-h-64 overflow-hidden">
              <div className="absolute left-1/2 top-6 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-xl border border-white/15 bg-white/10 font-mono text-lg font-bold text-white shadow-xl">
                SQL
              </div>
              <div className="absolute left-1/2 top-24 -translate-x-1/2 text-center">
                <div className="text-2xl font-semibold leading-tight text-white">
                  SQL at Your Fingertips
                </div>
                <div className="mt-1 text-xs text-white/60">
                  clause by clause
                </div>
              </div>
              <div className="absolute -bottom-9 left-7 h-36 w-24 -rotate-12 rounded-2xl border border-white/15 bg-[#0b0d14] p-2 shadow-2xl">
                <div className="mb-2 h-1.5 w-8 rounded bg-white/25" />
                <div className="space-y-1 font-mono text-[7px] text-blue-200">
                  <div>SELECT name</div>
                  <div>FROM users</div>
                  <div>WHERE plan</div>
                </div>
              </div>
              <div className="absolute -bottom-6 left-1/2 h-40 w-32 -translate-x-1/2 rounded-2xl border border-white/20 bg-[#090b12] p-3 shadow-2xl">
                <div className="mb-3 flex justify-between text-[7px] text-white/55">
                  <span>08:33</span>
                  <span>SQL</span>
                </div>
                <div className="space-y-1.5 font-mono text-[8px]">
                  <div className="text-pink-300">SELECT city, COUNT(*)</div>
                  <div className="text-blue-200">FROM customers</div>
                  <div className="text-emerald-200">GROUP BY city;</div>
                </div>
              </div>
              <div className="absolute -bottom-9 right-7 h-36 w-24 rotate-12 rounded-2xl border border-white/15 bg-[#0b0d14] p-2 shadow-2xl">
                <div className="mb-2 h-1.5 w-8 rounded bg-white/25" />
                <div className="space-y-1 font-mono text-[7px] text-purple-200">
                  <div>JOIN orders</div>
                  <div>ON id =</div>
                  <div>customer_id</div>
                </div>
              </div>
            </div>
          </Link>
        </section>
        {paths.map((path) => (
          <section key={path.key}>
            <div className="mb-3">
              <h2 className="text-base font-semibold">{path.title}</h2>
              <p className="text-sm text-sub">{path.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {path.scenarios.map((s: any) => {
                const inner = (
                  <>
                    <div className="flex items-center justify-between">
                      <Difficulty level={s.difficulty} />
                      {s.available ? (
                        <StatusPill status={s.progress?.status} />
                      ) : (
                        <span className="tag">Coming soon</span>
                      )}
                    </div>
                    <h3 className="mt-3 font-semibold">{s.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-sub">
                      {s.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.skills?.map((sk: string) => (
                        <span key={sk} className="tag">
                          {sk}
                        </span>
                      ))}
                    </div>
                  </>
                );
                return s.available ? (
                  <Link
                    key={s.key}
                    href={`/scenario/${s.key}`}
                    className="card p-4 transition-colors hover:border-accent"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div
                    key={s.key}
                    className="card p-4 opacity-60"
                    title="Not yet authored"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
}
