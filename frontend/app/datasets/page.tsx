"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader } from "@/components/ui";
import ResultsTable from "@/components/ResultsTable";
import SchemaCanvas from "@/components/SchemaCanvas";
import { api } from "@/lib/api";

type DrawerTab = "schema" | "data";

export default function DatasetsPage() {
  const router = useRouter();
  const [datasets, setDatasets] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drawerDataset, setDrawerDataset] = useState<any | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("schema");
  const [schema, setSchema] = useState<any>({ tables: [], relations: [] });
  const [dataTable, setDataTable] = useState<string | null>(null);
  const [dataResult, setDataResult] = useState<any>(null);
  const [dataBusy, setDataBusy] = useState(false);
  const [drawerErr, setDrawerErr] = useState<string | null>(null);

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

  async function explore(dataset: any) {
    setDrawerDataset(dataset);
    setDrawerTab("schema");
    setSchema({ tables: [], relations: [] });
    setDataTable(null);
    setDataResult(null);
    setDrawerErr(null);
    try {
      setSchema(await api.globalDatasetSchema(dataset.key));
    } catch (e: any) {
      setDrawerErr(e.message);
    }
  }

  async function loadTable(name: string) {
    if (!drawerDataset) return;
    setDataTable(name);
    setDataBusy(true);
    setDrawerErr(null);
    try {
      setDataResult(await api.globalDatasetPreview(drawerDataset.key, name));
    } catch (e: any) {
      setDrawerErr(e.message);
    } finally {
      setDataBusy(false);
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

              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="btn"
                  onClick={() => explore(d)}
                  disabled={!!busy}
                >
                  Explore Dataset
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => use(d.key)}
                  disabled={!!busy}
                >
                  {busy === d.key ? "Cloning…" : "Use Dataset"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {drawerDataset && (
        <div className="fixed inset-0 z-50">
          <button
            className="absolute inset-0 cursor-default bg-ink/20"
            aria-label="Close dataset explorer"
            onClick={() => setDrawerDataset(null)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-line bg-white shadow-2xl md:w-1/2">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">
                  {drawerDataset.name}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-sub">
                  <span className="tag">{drawerDataset.category}</span>
                  <span>{drawerDataset.table_count} tables</span>
                  <span>{drawerDataset.total_rows.toLocaleString()} rows</span>
                </div>
              </div>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sub hover:bg-canvas hover:text-ink"
                onClick={() => setDrawerDataset(null)}
                aria-label="Close dataset explorer"
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-1 border-b border-line px-4">
              {(["schema", "data"] as DrawerTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDrawerTab(tab)}
                  className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                    drawerTab === tab
                      ? "border-accent text-ink"
                      : "border-transparent text-sub hover:text-ink"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {drawerErr && (
              <div className="border-b border-bad/20 bg-bad/5 px-4 py-2 text-xs text-bad">
                {drawerErr}
              </div>
            )}

            {drawerTab === "schema" && (
              <div className="min-h-0 flex-1">
                {schema.tables.length === 0 && !drawerErr ? (
                  <div className="flex h-full items-center justify-center text-sm text-sub">
                    Loading schema…
                  </div>
                ) : (
                  <SchemaCanvas
                    tables={schema.tables}
                    relations={schema.relations}
                    storageKey={`sqlforge_global_schema_pos_${drawerDataset.key}`}
                  />
                )}
              </div>
            )}

            {drawerTab === "data" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-wrap gap-1.5 border-b border-line p-3">
                  {(schema.tables.length ? schema.tables : drawerDataset.tables).map(
                    (t: any) => (
                      <button
                        key={t.name}
                        onClick={() => loadTable(t.name)}
                        className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                          dataTable === t.name
                            ? "border-accent bg-accent text-white"
                            : "border-line bg-white text-ink hover:bg-canvas"
                        }`}
                        title={`${t.row_count} rows`}
                      >
                        {t.name}
                        <span
                          className={`ml-1.5 ${
                            dataTable === t.name ? "text-white/70" : "text-sub"
                          }`}
                        >
                          {t.row_count}
                        </span>
                      </button>
                    )
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {!dataTable ? (
                    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-sub">
                      Pick a table to browse its rows (first 200).
                    </div>
                  ) : dataBusy ? (
                    <div className="p-4 text-sm text-sub">
                      Loading {dataTable}…
                    </div>
                  ) : (
                    <>
                      {dataResult?.ok && (
                        <div className="border-b border-line px-3 py-1.5 text-xs text-sub">
                          {dataResult.row_count} rows shown
                        </div>
                      )}
                      <ResultsTable result={dataResult} />
                    </>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </Shell>
  );
}
