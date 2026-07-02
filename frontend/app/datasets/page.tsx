"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function DatasetsPage() {
  const router = useRouter();
  const [datasets, setDatasets] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .globalDatasets()
      .then(setDatasets)
      .catch((e) => setErr(e.message));
  }, []);

  async function use(key: string) {
    setBusy(key);
    setErr(null);
    try {
      const t = await api.useGlobalDataset(key);
      // clone succeeded — open the user's private replica
      router.push(`/tracks/${t.id}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Global Datasets"
        subtitle="Explore real-world public datasets. Spin up your own private replica to query, learn, and research — your work never touches anyone else's copy."
      />
      <div className="space-y-6 px-8 py-6">
        {err && <p className="text-sm text-bad">{err}</p>}

        {datasets.length === 0 && !err && (
          <p className="text-sm text-sub">Loading catalog…</p>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {datasets.map((d) => (
            <div key={d.key} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{d.name}</h3>
                  <span className="tag mt-1 inline-block">{d.category}</span>
                </div>
                <div className="shrink-0 text-right text-xs text-sub">
                  <div>
                    {d.table_count} table{d.table_count === 1 ? "" : "s"}
                  </div>
                  <div>{d.total_rows.toLocaleString()} rows</div>
                </div>
              </div>

              <p className="mt-3 text-sm text-sub">{d.description}</p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {d.tables.map((t: any) => (
                  <span
                    key={t.name}
                    title={`${t.columns.join(", ")}\n${t.row_count} rows`}
                    className="rounded-md border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink"
                  >
                    {t.name}
                    <span className="ml-1.5 text-sub">{t.row_count}</span>
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-sub">
                  Creates a private copy you can query and reset freely.
                </span>
                <button
                  className="btn btn-primary"
                  onClick={() => use(d.key)}
                  disabled={!!busy}
                >
                  {busy === d.key ? "Cloning…" : "Use dataset →"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
