"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

export default function PipelinesPage() {
  const router = useRouter();
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    api.pipelines().then(setPipelines).catch((e) => setErr(e.message));
  }
  useEffect(load, []);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const p = await api.createPipeline(name.trim() || "Untitled pipeline");
      router.push(`/pipelines/${p.id}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this pipeline? This cannot be undone.")) return;
    try {
      await api.deletePipeline(id);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Pipelines"
        subtitle="Data Engineering DEI — build real data pipelines on a canvas: pull from sources, transform with Python, branch on conditions, reason with LLMs, and stream out. Every run executes in your private sandbox and is logged."
      />
      <div className="space-y-6 px-8 py-6">
        {err && <p className="text-sm text-bad">{err}</p>}

        <div className="card flex items-center gap-3 p-4">
          <input
            className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="New pipeline name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? "Creating…" : "+ New pipeline"}
          </button>
        </div>

        {pipelines.length === 0 && !err && (
          <p className="text-sm text-sub">
            No pipelines yet. Create one to open the builder.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {pipelines.map((p) => (
            <div key={p.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{p.name}</h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-sub">
                    <span
                      className={`tag ${
                        p.status === "active" ? "text-good" : ""
                      }`}
                    >
                      {p.status}
                    </span>
                    <span>{p.node_count} nodes</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn" onClick={() => remove(p.id)}>
                  Delete
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => router.push(`/pipelines/${p.id}`)}
                >
                  Open builder
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
