'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { PageHeader, Difficulty, StatusPill } from '@/components/ui';
import { api } from '@/lib/api';

const courses = [
  {
    href: '/paths/fundamentals-sql',
    title: 'Fundamentals of SQL',
    level: 'Beginner',
    desc: 'SQL and DBMS basics: DDL, DML, SELECT, joins, grouping, inserts, updates, deletes, and drops.',
    tags: ['SQL', 'DDL', 'DML'],
    glow: 'bg-[radial-gradient(circle_at_88%_88%,rgba(168,85,247,0.78),transparent_36%),linear-gradient(135deg,#0b1020,#19346e_45%,#07080d)]',
  },
  {
    href: '/paths/indexing',
    title: 'Indexing',
    level: 'Core performance',
    desc: 'Learn why indexes exist, where they help, where they hurt, and how to design them from query patterns.',
    tags: ['INDEX', 'PLAN', 'LOOKUP'],
    glow: 'bg-[radial-gradient(circle_at_88%_88%,rgba(20,184,166,0.76),transparent_36%),linear-gradient(135deg,#071114,#153f55_45%,#07080d)]',
  },
  {
    href: '/paths/query-optimization',
    title: 'Query Optimization',
    level: 'Performance',
    desc: 'Read plans, reduce rows, fix joins, filter early, sort carefully, and optimize with evidence.',
    tags: ['EXPLAIN', 'JOIN', 'FILTER'],
    glow: 'bg-[radial-gradient(circle_at_88%_88%,rgba(236,72,153,0.68),transparent_36%),linear-gradient(135deg,#171007,#7a4a0b_45%,#08070d)]',
  },
  {
    href: '/paths/plsql',
    title: 'PL/SQL',
    level: 'Procedural SQL',
    desc: 'Procedural Language for SQL: blocks, variables, procedures, functions, packages, cursors, and exceptions.',
    tags: ['BLOCKS', 'PROC', 'FUNC'],
    glow: 'bg-[radial-gradient(circle_at_88%_88%,rgba(14,165,233,0.68),transparent_36%),linear-gradient(135deg,#090b1c,#2e2f86_45%,#07080d)]',
  },
  {
    href: '/paths/dtl',
    title: 'DTL',
    level: 'Transactions',
    desc: 'Data Transaction Language: commits, rollbacks, savepoints, isolation, ACID guarantees, and failure-safe changes.',
    tags: ['COMMIT', 'ACID', 'ROLLBACK'],
    glow: 'bg-[radial-gradient(circle_at_88%_88%,rgba(34,197,94,0.7),transparent_36%),linear-gradient(135deg,#07140c,#155e3a_45%,#07080d)]',
  },
];

export default function PathsPage() {
  const [paths, setPaths] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .paths()
      .then(setPaths)
      .catch((e) => setErr(e.message));
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
                className="group relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-[#101217] p-5 shadow-xl transition-transform hover:-translate-y-0.5"
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
                  <h3 className="mt-2 text-2xl font-semibold leading-tight">
                    {course.title}
                  </h3>
                  <p className="mt-3 text-xs text-white/68">{course.desc}</p>
                  {/* <div className="mt-4 flex flex-wrap gap-1.5">
                    {course.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/72"
                      >
                        {tag}
                      </span>
                    ))}
                  </div> */}
                  <div className="mt-auto pt-4">
                    <span className="inline-flex rounded-md bg-white px-4 py-2 text-sm font-medium text-ink transition-transform group-hover:translate-x-1">
                      Start course →
                    </span>
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
