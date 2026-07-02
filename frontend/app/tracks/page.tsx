"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader, Difficulty } from "@/components/ui";
import { api } from "@/lib/api";

const LEVELS = [
  { v: 1, label: "Beginner — SELECT, COUNT, WHERE" },
  { v: 2, label: "Easy — filters, ORDER BY, top-N" },
  { v: 3, label: "Intermediate — GROUP BY, aggregates" },
  { v: 4, label: "Advanced — JOINs across tables" },
  { v: 5, label: "Expert — multi-join, windows" },
];

export default function TracksPage() {
  const router = useRouter();
  const [tracks, setTracks] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // custom (CSV upload) vs public (pick from the global catalog)
  const [mode, setMode] = useState<"custom" | "public">("custom");
  const [datasets, setDatasets] = useState<any[]>([]);
  const [selectedKey, setSelectedKey] = useState("");

  function load() {
    api.tracks().then(setTracks).catch((e) => setErr(e.message));
  }
  useEffect(load, []);

  // load the public catalog once, when the panel is first opened
  useEffect(() => {
    if (creating && datasets.length === 0) {
      api
        .globalDatasets()
        .then((d) => {
          setDatasets(d);
          if (d.length) setSelectedKey((k) => k || d[0].key);
        })
        .catch(() => {});
    }
  }, [creating, datasets.length]);

  async function usePublic() {
    if (!selectedKey) return;
    setBusy(true);
    setErr(null);
    try {
      const t = await api.useGlobalDataset(selectedKey);
      router.push(`/tracks/${t.id}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!files || files.length === 0) {
      setErr("Choose at least one CSV file.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const t = await api.createTrack(name || "Untitled dataset", level, files);
      router.push(`/tracks/${t.id}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  async function remove(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this track and its data?")) return;
    await api.deleteTrack(id);
    load();
  }

  return (
    <Shell>
      <PageHeader
        title="Custom Tracks"
        subtitle="Import your own dataset and let the AI build an adaptive SQL course around it."
        right={
          <button className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
            {creating ? "Close" : "+ New track"}
          </button>
        }
      />
      <div className="space-y-6 px-8 py-6">
        {err && <p className="text-sm text-bad">{err}</p>}

        {creating && (
          <div className="card space-y-4 p-5">
            {/* dataset source: custom upload vs public catalog */}
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["custom", "Custom dataset", "Upload your own CSV files"],
                  ["public", "Public datasets", "Pick a ready-made global dataset"],
                ] as const
              ).map(([val, label, hint]) => (
                <label
                  key={val}
                  className={`flex flex-1 cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                    mode === val
                      ? "border-accent bg-accent/5"
                      : "border-line hover:border-accent/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="dataset-source"
                    checked={mode === val}
                    onChange={() => setMode(val)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-sub">{hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {mode === "public" ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Choose a dataset
                  </label>
                  <select
                    value={selectedKey}
                    onChange={(e) => setSelectedKey(e.target.value)}
                    className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                  >
                    {datasets.length === 0 && (
                      <option value="">Loading catalog…</option>
                    )}
                    {datasets.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.name} — {d.category} ({d.table_count} table
                        {d.table_count === 1 ? "" : "s"}, {d.total_rows.toLocaleString()} rows)
                      </option>
                    ))}
                  </select>
                </div>

                {(() => {
                  const d = datasets.find((x) => x.key === selectedKey);
                  if (!d) return null;
                  return (
                    <div className="rounded-md border border-line bg-canvas p-3">
                      <p className="text-sm text-sub">{d.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.tables.map((t: any) => (
                          <span
                            key={t.name}
                            title={t.columns.join(", ")}
                            className="rounded-md border border-line bg-white px-2 py-1 font-mono text-xs"
                          >
                            {t.name}
                            <span className="ml-1.5 text-sub">{t.row_count}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <button
                  className="btn btn-primary"
                  onClick={usePublic}
                  disabled={busy || !selectedKey}
                >
                  {busy ? "Cloning…" : "Use dataset & start"}
                </button>
                <p className="text-xs text-sub">
                  A private copy is ingested into fresh tables just for you — your
                  work never affects the shared dataset.
                </p>
              </div>
            ) : (
              <form onSubmit={create} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Track name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My e-commerce export"
                  className="w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Starting difficulty
                </label>
                <select
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                  className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {LEVELS.map((l) => (
                    <option key={l.v} value={l.v}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Dataset (CSV files){" "}
                <span className="text-sub">— one table per file</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                multiple
                onChange={(e) => setFiles(e.target.files)}
                className="block w-full text-sm text-sub file:mr-3 file:rounded-md file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-white"
              />
              {files && files.length > 0 && (
                <p className="mt-2 text-xs text-sub">
                  {Array.from(files).map((f) => f.name).join(", ")}
                </p>
              )}
              <p className="mt-2 text-xs text-sub">
                The first row is treated as the header. Column types and table
                relations are inferred automatically.
              </p>
            </div>
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? "Importing…" : "Import & start learning"}
                </button>
              </form>
            )}
          </div>
        )}

        {tracks.length === 0 && !creating && (
          <div className="card p-8 text-center">
            <p className="text-sm text-sub">
              No custom tracks yet. Import a CSV dataset to begin an AI-guided,
              adaptive practice track on your own data.
            </p>
            <button
              className="btn btn-primary mt-4"
              onClick={() => setCreating(true)}
            >
              + New track
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tracks.map((t) => (
            <div
              key={t.id}
              onClick={() => router.push(`/tracks/${t.id}`)}
              className="card cursor-pointer p-4 transition-colors hover:border-accent"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`tag ${
                    t.status === "active" ? "border-ok/30 bg-ok/10 text-ok" : ""
                  }`}
                >
                  {t.status === "active" ? "live" : "idle"}
                </span>
                <Difficulty level={t.level} />
              </div>
              <h3 className="mt-3 truncate font-semibold">{t.name}</h3>
              <p className="mt-1 text-sm text-sub">
                {t.tables} table{t.tables === 1 ? "" : "s"} ·{" "}
                {new Date(t.created_at).toLocaleDateString()}
              </p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-medium text-accent">
                  Open workbench →
                </span>
                <button
                  onClick={(e) => remove(t.id, e)}
                  className="text-xs text-sub hover:text-bad"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
