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
