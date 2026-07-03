"use client";

import Editor from "@monaco-editor/react";
import { useEffect, useState } from "react";
import ResultsTable from "@/components/ResultsTable";
import { api } from "@/lib/api";
import { NODE_META } from "./nodes";

const DEFAULT_CODE = `def transform(df):
    # df is a pandas DataFrame of the incoming rows.
    # Validate, parse, reshape or format, then return a DataFrame or list[dict].
    return df
`;

const COMING_SOON = (
  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
    coming soon
  </span>
);

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-sub">{label}</div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export default function ConfigPanel({
  pipelineId,
  node,
  edges,
  nodes,
  onChange,
  onClose,
}: {
  pipelineId: number | string;
  node: any;
  edges: any[];
  nodes: any[];
  onChange: (nodeId: string, patch: any) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [catalog, setCatalog] = useState<any[]>([]);

  useEffect(() => {
    setPreview(null);
    setMsg(null);
  }, [node?.id]);

  // catalog of public datasets (for the datasource dropdown)
  useEffect(() => {
    if (node?.type === "datasource" && catalog.length === 0) {
      api.globalDatasets().then(setCatalog).catch(() => {});
    }
  }, [node?.type, catalog.length]);

  if (!node) return null;
  const type = node.type;
  const data = node.data || {};
  const meta = NODE_META[type];
  const set = (patch: any) => onChange(node.id, patch);

  async function loadPreview() {
    setPreviewBusy(true);
    setMsg(null);
    try {
      setPreview(await api.pipelineNodePreview(pipelineId, node.id));
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setPreviewBusy(false);
    }
  }

  async function uploadCsv(file: File) {
    setMsg("Uploading…");
    try {
      const res = await api.pipelineUploadCsv(pipelineId, node.id, file);
      set({
        kind: "csv",
        table_name: res.table_name,
        columns: res.columns,
        row_count: res.row_count,
      });
      setPreview({
        ok: true,
        columns: res.columns.map((c: any) => c.name),
        rows: res.preview,
        row_count: res.row_count,
      });
      setMsg(`Imported ${res.row_count} rows into “${res.table_name}”.`);
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function genPrompt() {
    setMsg("Asking AI…");
    try {
      const cols = (data.columns || []).map((c: any) => c.name || c);
      const res = await api.pipelineGenPrompt(pipelineId, intent, cols);
      set({ system_prompt: res.prompt });
      setMsg("Prompt generated.");
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  const outEdges = edges.filter((e) => e.source === node.id);
  const nodeLabel = (id: string) =>
    nodes.find((n) => n.id === id)?.data?.label ||
    nodes.find((n) => n.id === id)?.type ||
    id;

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded text-sm text-white"
            style={{ background: meta.color }}
          >
            {meta.glyph}
          </span>
          <div className="text-sm font-semibold">{meta.label}</div>
        </div>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-canvas hover:text-ink"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Node label">
          <input
            className={inputCls}
            value={data.label || ""}
            placeholder={meta.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </Field>

        {/* ---------------- Datasource ---------------- */}
        {type === "datasource" && (
          <>
            <Field label="Source kind">
              <select
                className={inputCls}
                value={data.kind || "csv"}
                onChange={(e) => set({ kind: e.target.value })}
              >
                <option value="csv">CSV upload</option>
                <option value="public">Public dataset</option>
                <option value="postgres">Postgres database</option>
                <option value="api">HTTP API</option>
                <option value="ws">WebSocket (real-time)</option>
              </select>
            </Field>

            {data.kind === "csv" || !data.kind ? (
              <Field label="CSV file">
                <input
                  type="file"
                  accept=".csv"
                  className="text-xs"
                  onChange={(e) =>
                    e.target.files?.[0] && uploadCsv(e.target.files[0])
                  }
                />
                {data.table_name && (
                  <div className="mt-1 text-[11px] text-sub">
                    Imported table: <b>{data.table_name}</b> ({data.row_count} rows)
                  </div>
                )}
              </Field>
            ) : null}

            {data.kind === "public" && (
              <>
                <Field label="Dataset">
                  <select
                    className={inputCls}
                    value={data.dataset_key || ""}
                    onChange={(e) =>
                      set({ dataset_key: e.target.value, table: "" })
                    }
                  >
                    <option value="">
                      {catalog.length ? "Select a dataset…" : "Loading…"}
                    </option>
                    {catalog.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.name} ({d.table_count} tables)
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Table (blank = first table)">
                  <select
                    className={inputCls}
                    value={data.table || ""}
                    disabled={!data.dataset_key}
                    onChange={(e) => set({ table: e.target.value })}
                  >
                    <option value="">First table</option>
                    {(
                      catalog.find((d) => d.key === data.dataset_key)?.tables ||
                      []
                    ).map((t: any) => (
                      <option key={t.name} value={t.name}>
                        {t.name} ({t.row_count} rows)
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {data.kind === "postgres" && (
              <>
                <Field label="Connection DSN">
                  <input
                    className={inputCls}
                    placeholder="postgresql://user:pass@host:5432/db"
                    value={data.dsn || ""}
                    onChange={(e) => set({ dsn: e.target.value })}
                  />
                </Field>
                <Field label="SELECT query">
                  <textarea
                    className={`${inputCls} h-20 font-mono`}
                    placeholder="SELECT * FROM public.orders"
                    value={data.query || ""}
                    onChange={(e) => set({ query: e.target.value })}
                  />
                </Field>
              </>
            )}

            {data.kind === "api" && (
              <>
                <Field label="URL">
                  <input
                    className={inputCls}
                    placeholder="https://api.example.com/data"
                    value={data.url || ""}
                    onChange={(e) => set({ url: e.target.value })}
                  />
                </Field>
                <Field label="Method">
                  <select
                    className={inputCls}
                    value={data.method || "GET"}
                    onChange={(e) => set({ method: e.target.value })}
                  >
                    <option>GET</option>
                    <option>POST</option>
                  </select>
                </Field>
              </>
            )}

            {data.kind === "ws" && (
              <div className="rounded-md border border-line bg-canvas p-3 text-xs text-sub">
                Real-time WebSocket ingestion {COMING_SOON}
                <input
                  className={`${inputCls} mt-2`}
                  placeholder="wss://stream.example.com"
                  value={data.ws_url || ""}
                  onChange={(e) => set({ ws_url: e.target.value })}
                />
              </div>
            )}
          </>
        )}

        {/* ---------------- Function ---------------- */}
        {type === "function" && (
          <Field label="Python transform">
            <div className="overflow-hidden rounded-md border border-line">
              <Editor
                height="260px"
                defaultLanguage="python"
                value={data.code || DEFAULT_CODE}
                onChange={(v) => set({ code: v ?? "" })}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-sub">
              Define <code>transform(df)</code> returning a DataFrame or list of
              dicts. Runs in an isolated subprocess.
            </p>
          </Field>
        )}

        {/* ---------------- Gate ---------------- */}
        {type === "gate" && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-sub">
              Branch conditions (per outgoing edge)
            </div>
            {outEdges.length === 0 && (
              <p className="text-[11px] text-sub">
                Connect this gate to downstream nodes, then set a predicate for
                each branch.
              </p>
            )}
            {outEdges.map((e) => {
              const cond = (data.conditions || []).find(
                (c: any) => c.target === e.target
              );
              return (
                <Field key={e.id} label={`→ ${nodeLabel(e.target)}`}>
                  <input
                    className={`${inputCls} font-mono`}
                    placeholder="e.g. amount > 100"
                    value={cond?.expr || ""}
                    onChange={(ev) => {
                      const others = (data.conditions || []).filter(
                        (c: any) => c.target !== e.target
                      );
                      set({
                        conditions: [
                          ...others,
                          { target: e.target, expr: ev.target.value },
                        ],
                      });
                    }}
                  />
                </Field>
              );
            })}
            <p className="text-[11px] text-sub">
              Expressions use row columns as variables. Rows matching a branch
              flow to that path; a blank predicate passes everything.
            </p>
          </div>
        )}

        {/* ---------------- LLM ---------------- */}
        {type === "llm" && (
          <>
            <Field label="AI model">
              <input
                className={inputCls}
                placeholder="e.g. gpt-4o-mini, lightning-ai/gemma-4-31B-it"
                value={data.model || ""}
                onChange={(e) => set({ model: e.target.value })}
              />
            </Field>
            <Field label="API key (stored on this node)">
              <input
                className={inputCls}
                type="password"
                value={data.api_key || ""}
                onChange={(e) => set({ api_key: e.target.value })}
              />
            </Field>
            <Field label="System prompt">
              <textarea
                className={`${inputCls} h-24`}
                value={data.system_prompt || ""}
                onChange={(e) => set({ system_prompt: e.target.value })}
              />
            </Field>
            <div className="rounded-md border border-line bg-canvas p-2">
              <div className="text-[11px] font-medium text-sub">
                Let our AI write the system prompt
              </div>
              <input
                className={`${inputCls} mt-1`}
                placeholder="Describe what this node should do…"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
              />
              <button className="btn mt-2 w-full" onClick={genPrompt}>
                Generate prompt
              </button>
            </div>
            <div className="text-[11px] text-sub">
              Row-by-row reasoning execution {COMING_SOON} (rows pass through for
              now).
            </div>
          </>
        )}

        {/* ---------------- Output ---------------- */}
        {type === "output" && (
          <>
            <Field label="Delivery target">
              <select
                className={inputCls}
                value={data.kind || "api"}
                onChange={(e) => set({ kind: e.target.value })}
              >
                <option value="sse">Server-Sent Events (SSE)</option>
                <option value="api">REST API endpoint</option>
                <option value="ws">WebSocket</option>
                <option value="sheets">Google Sheets</option>
                <option value="alert">Alert on trigger</option>
              </select>
            </Field>
            <Field label="Target (URL / sheet id / channel)">
              <input
                className={inputCls}
                value={data.target || ""}
                onChange={(e) => set({ target: e.target.value })}
              />
            </Field>
            <div className="text-[11px] text-sub">
              Delivery execution {COMING_SOON} — config is saved and rows pass
              through so you can chain further.
            </div>
          </>
        )}

        {msg && <div className="text-[11px] text-sub">{msg}</div>}

        {/* ---- Output preview (last run) ---- */}
        {type !== "output" && (
          <div className="border-t border-line pt-3">
            <button
              className="btn w-full"
              onClick={loadPreview}
              disabled={previewBusy}
            >
              {previewBusy ? "Loading…" : "Preview output (last run)"}
            </button>
            {preview && (
              <div className="mt-2 max-h-64 overflow-auto rounded-md border border-line">
                <ResultsTable result={preview} />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
