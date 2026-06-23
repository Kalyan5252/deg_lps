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

  function load() {
    api.tracks().then(setTracks).catch((e) => setErr(e.message));
  }
  useEffect(load, []);

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
          <form onSubmit={create} className="card space-y-4 p-5">
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
