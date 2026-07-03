"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader, Difficulty, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";

const courses = [
  {
    href: "/paths/fundamentals-sql",
    title: "Fundamentals of SQL",
    level: "Beginner",
    desc: "SQL and DBMS basics: DDL, DML, SELECT, joins, grouping, inserts, updates, deletes, and drops.",
    tags: ["SQL", "DDL", "DML"],
    glow:
      "bg-[radial-gradient(circle_at_25%_20%,rgba(47,109,246,0.88),transparent_34%),radial-gradient(circle_at_76%_26%,rgba(168,85,247,0.68),transparent_32%),linear-gradient(135deg,#0b1020,#172033_52%,#07080d)]",
  },
  {
    href: "/paths/indexing",
    title: "Indexing",
    level: "Core performance",
    desc: "Learn why indexes exist, where they help, where they hurt, and how to design them from query patterns.",
    tags: ["INDEX", "PLAN", "LOOKUP"],
    glow:
      "bg-[radial-gradient(circle_at_28%_22%,rgba(20,184,166,0.78),transparent_35%),radial-gradient(circle_at_74%_20%,rgba(47,109,246,0.66),transparent_32%),linear-gradient(135deg,#071114,#10202b_52%,#07080d)]",
  },
  {
    href: "/paths/query-optimization",
    title: "Query Optimization",
    level: "Performance",
    desc: "Read plans, reduce rows, fix joins, filter early, sort carefully, and optimize with evidence.",
    tags: ["EXPLAIN", "JOIN", "FILTER"],
    glow:
      "bg-[radial-gradient(circle_at_28%_18%,rgba(245,158,11,0.72),transparent_34%),radial-gradient(circle_at_78%_24%,rgba(236,72,153,0.58),transparent_32%),linear-gradient(135deg,#171007,#211827_52%,#08070d)]",
  },
  {
    href: "/paths/plsql",
    title: "PL/SQL",
    level: "Procedural SQL",
    desc: "Procedural Language for SQL: blocks, variables, procedures, functions, packages, cursors, and exceptions.",
    tags: ["BLOCKS", "PROC", "FUNC"],
    glow:
      "bg-[radial-gradient(circle_at_28%_22%,rgba(99,102,241,0.82),transparent_34%),radial-gradient(circle_at_74%_20%,rgba(14,165,233,0.62),transparent_32%),linear-gradient(135deg,#090b1c,#121d35_52%,#07080d)]",
  },
];

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
              Focused courses with presentation-style screens and direct jump
              navigation.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {courses.map((course) => (
              <Link
                key={course.href}
                href={course.href}
                className="group relative min-h-80 overflow-hidden rounded-lg border border-white/10 bg-[#101217] p-5 shadow-xl transition-transform hover:-translate-y-0.5"
              >
                <div className={`absolute inset-0 ${course.glow}`} />
                <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:34px_34px]" />
                <div className="relative flex h-full flex-col text-white">
                  <div className="flex items-center justify-between">
                    <span className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/82">
                      Course
                    </span>
                    <span className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-xs text-white/72">
                      {course.level}
                    </span>
                  </div>
                  <div className="mt-6 flex h-14 w-14 items-center justify-center rounded-xl border border-white/15 bg-white/10 font-mono text-lg font-bold shadow-xl">
                    {course.title.split(" ")[0].slice(0, 3).toUpperCase()}
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold leading-tight">
                    {course.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-white/68">
                    {course.desc}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {course.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/72"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto pt-6">
                    <span className="inline-flex rounded-md bg-white px-4 py-2 text-sm font-medium text-ink transition-transform group-hover:translate-x-1">
                      Start course →
                    </span>
                  </div>
                  <div className="absolute -bottom-8 right-5 h-36 w-24 rotate-12 rounded-2xl border border-white/15 bg-[#080a10]/90 p-2 shadow-2xl">
                    <div className="mb-2 h-1.5 w-8 rounded bg-white/25" />
                    <div className="space-y-1 font-mono text-[7px] text-blue-100">
                      <div>SELECT *</div>
                      <div>EXPLAIN</div>
                      <div>CREATE</div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
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
