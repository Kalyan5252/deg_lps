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

const DEFAULT_GATE_BODY = `    # each input is a list of dict rows; return the combined rows
    return input_1`;

const COINBASE_SUBSCRIBE = [
  '{"type":"subscribe","product_ids":["BTC-USD","ETH-USD","SOL-USD"],"channel":"market_trades"}',
  '{"type":"subscribe","channel":"heartbeats"}',
].join("\n");

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

// A reusable key/value list editor (used for headers and form body fields).
function KVList({
  rows,
  onChange,
  addLabel,
}: {
  rows: { k: string; v: string }[];
  onChange: (next: { k: string; v: string }[]) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((h, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            className={`${inputCls} flex-1`}
            placeholder="Key"
            value={h.k}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...h, k: e.target.value };
              onChange(next);
            }}
          />
          <input
            className={`${inputCls} flex-1`}
            placeholder="Value"
            value={h.v}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...h, v: e.target.value };
              onChange(next);
            }}
          />
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sub hover:bg-canvas hover:text-bad"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="text-xs text-accent hover:underline"
        onClick={() => onChange([...rows, { k: "", v: "" }])}
      >
        {addLabel}
      </button>
    </div>
  );
}

export default function ConfigPanel({
  pipelineId,
  node,
  edges,
  nodes,
  onChange,
  getGraph,
  onClose,
}: {
  pipelineId: number | string;
  node: any;
  edges: any[];
  nodes: any[];
  onChange: (nodeId: string, patch: any) => void;
  getGraph: () => any;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [catalog, setCatalog] = useState<any[]>([]);
  const [hdrs, setHdrs] = useState<{ k: string; v: string }[]>([]);
  const [bodyFields, setBodyFields] = useState<{ k: string; v: string }[]>([]);

  useEffect(() => {
    setPreview(null);
    setMsg(null);
    const h = (node?.data?.headers || {}) as Record<string, string>;
    setHdrs(Object.entries(h).map(([k, v]) => ({ k, v: String(v) })));
    setBodyFields(
      (node?.data?.body_fields || []).map((f: any) => ({
        k: f.key ?? "",
        v: f.value ?? "",
      }))
    );
  }, [node?.id]);

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
    setPreview(null);
    try {
      setPreview(await api.pipelineNodePreview(pipelineId, node.id, getGraph()));
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

  // --- dynamic API headers -------------------------------------------------
  function syncHeaders(next: { k: string; v: string }[]) {
    setHdrs(next);
    const obj: Record<string, string> = {};
    next.forEach(({ k, v }) => {
      if (k.trim()) obj[k.trim()] = v;
    });
    set({ headers: obj });
  }

  function syncBodyFields(next: { k: string; v: string }[]) {
    setBodyFields(next);
    set({
      body_fields: next
        .filter((f) => f.k.trim())
        .map((f) => ({ key: f.k, value: f.v })),
    });
  }

  const outEdges = edges.filter((e) => e.source === node.id);
  const nodeLabel = (id: string) =>
    nodes.find((n) => n.id === id)?.data?.label ||
    nodes.find((n) => n.id === id)?.type ||
    id;

  // gate signature (locked) from the declared input count
  const gateInputs = Math.max(1, Number(data.inputs) || 1);
  const gateArgs = Array.from({ length: gateInputs }, (_, i) => `input_${i + 1}`);
  const gateSignature = `def conditional_function(${gateArgs.join(", ")}):`;

  return (
    <aside className="flex h-full w-[520px] shrink-0 flex-col border-l border-line bg-white">
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
                <option value="ws">WebSocket (live stream)</option>
              </select>
            </Field>

            {(data.kind === "csv" || !data.kind) && (
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
            )}

            {data.kind === "public" && (
              <>
                <Field label="Dataset">
                  <select
                    className={inputCls}
                    value={data.dataset_key || ""}
                    onChange={(e) => set({ dataset_key: e.target.value, table: "" })}
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
                    {(catalog.find((d) => d.key === data.dataset_key)?.tables || []).map(
                      (t: any) => (
                        <option key={t.name} value={t.name}>
                          {t.name} ({t.row_count} rows)
                        </option>
                      )
                    )}
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
                    <option>PUT</option>
                    <option>PATCH</option>
                    <option>DELETE</option>
                  </select>
                </Field>

                {/* dynamic headers */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium text-sub">Headers</span>
                    <button
                      className="text-xs text-accent hover:underline"
                      onClick={() => syncHeaders([...hdrs, { k: "", v: "" }])}
                    >
                      + Add header
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {hdrs.length === 0 && (
                      <p className="text-[11px] text-sub">
                        No headers. Add e.g. <code>Authorization: Bearer …</code>
                      </p>
                    )}
                    {hdrs.map((h, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          className={`${inputCls} flex-1`}
                          placeholder="Header"
                          value={h.k}
                          onChange={(e) => {
                            const next = [...hdrs];
                            next[i] = { ...h, k: e.target.value };
                            syncHeaders(next);
                          }}
                        />
                        <input
                          className={`${inputCls} flex-1`}
                          placeholder="Value"
                          value={h.v}
                          onChange={(e) => {
                            const next = [...hdrs];
                            next[i] = { ...h, v: e.target.value };
                            syncHeaders(next);
                          }}
                        />
                        <button
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sub hover:bg-canvas hover:text-bad"
                          onClick={() =>
                            syncHeaders(hdrs.filter((_, j) => j !== i))
                          }
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {data.method && data.method !== "GET" && (
                  <>
                    <Field label="Body type">
                      <select
                        className={inputCls}
                        value={data.body_type || "none"}
                        onChange={(e) => set({ body_type: e.target.value })}
                      >
                        <option value="none">None</option>
                        <option value="json">JSON</option>
                        <option value="urlencoded">x-www-form-urlencoded</option>
                        <option value="formdata">form-data</option>
                        <option value="raw">Raw</option>
                        <option value="xml">XML</option>
                      </select>
                    </Field>

                    {data.body_type === "json" && (
                      <Field label="JSON body">
                        <textarea
                          className={`${inputCls} h-24 font-mono`}
                          placeholder='{"key": "value"}'
                          value={
                            typeof data.body === "string"
                              ? data.body
                              : data.body
                              ? JSON.stringify(data.body, null, 2)
                              : ""
                          }
                          onChange={(e) => {
                            try {
                              set({ body: JSON.parse(e.target.value) });
                            } catch {
                              set({ body: e.target.value });
                            }
                          }}
                        />
                      </Field>
                    )}

                    {(data.body_type === "urlencoded" ||
                      data.body_type === "formdata") && (
                      <div>
                        <div className="mb-1 text-xs font-medium text-sub">
                          {data.body_type === "formdata"
                            ? "Form-data fields"
                            : "URL-encoded fields"}
                        </div>
                        <KVList
                          rows={bodyFields}
                          onChange={syncBodyFields}
                          addLabel="+ Add field"
                        />
                      </div>
                    )}

                    {(data.body_type === "raw" || data.body_type === "xml") && (
                      <>
                        <Field
                          label={data.body_type === "xml" ? "XML body" : "Raw body"}
                        >
                          <textarea
                            className={`${inputCls} h-24 font-mono`}
                            value={data.raw_body || ""}
                            onChange={(e) => set({ raw_body: e.target.value })}
                          />
                        </Field>
                        {data.body_type === "raw" && (
                          <Field label="Content-Type">
                            <input
                              className={inputCls}
                              placeholder="text/plain"
                              value={data.raw_content_type || ""}
                              onChange={(e) =>
                                set({ raw_content_type: e.target.value })
                              }
                            />
                          </Field>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {data.kind === "ws" && (
              <div className="space-y-3 rounded-md border border-line bg-canvas p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink">
                    Live WebSocket connector
                  </span>
                  <button
                    className="text-xs text-accent hover:underline"
                    onClick={() =>
                      set({
                        ws_url: "wss://advanced-trade-ws.coinbase.com",
                        subscribe: COINBASE_SUBSCRIBE,
                        max_messages: 20,
                        max_seconds: 15,
                      })
                    }
                  >
                    Load Coinbase example
                  </button>
                </div>
                <Field label="WebSocket URL">
                  <input
                    className={inputCls}
                    placeholder="wss://stream.example.com"
                    value={data.ws_url || ""}
                    onChange={(e) => set({ ws_url: e.target.value })}
                  />
                </Field>
                <Field label="Subscribe messages (one JSON per line)">
                  <textarea
                    className={`${inputCls} h-24 font-mono text-xs`}
                    placeholder='{"type":"subscribe","channel":"…"}'
                    value={data.subscribe || ""}
                    onChange={(e) => set({ subscribe: e.target.value })}
                  />
                </Field>
                <div className="flex gap-2">
                  <Field label="Max messages">
                    <input
                      type="number"
                      className={inputCls}
                      value={data.max_messages ?? 20}
                      onChange={(e) =>
                        set({ max_messages: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="Max seconds">
                    <input
                      type="number"
                      className={inputCls}
                      value={data.max_seconds ?? 10}
                      onChange={(e) =>
                        set({ max_seconds: Number(e.target.value) })
                      }
                    />
                  </Field>
                </div>
                <p className="text-[11px] text-sub">
                  Collects a bounded window (until max messages or seconds) then
                  feeds those rows into the pipeline.
                </p>
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
          <div className="space-y-4">
            {/* dynamic inputs */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-sub">Inputs</span>
                <div className="flex items-center gap-2">
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded border border-line text-sub hover:bg-canvas disabled:opacity-40"
                    disabled={gateInputs <= 1}
                    onClick={() => set({ inputs: gateInputs - 1 })}
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm font-semibold">
                    {gateInputs}
                  </span>
                  <button
                    className="flex h-6 w-6 items-center justify-center rounded border border-line text-sub hover:bg-canvas"
                    onClick={() => set({ inputs: gateInputs + 1 })}
                  >
                    +
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-sub">
                Each input is a handle on top of the node (
                {gateArgs.join(", ")}). Connect a node to each.
              </p>
            </div>

            {/* conditional_function (locked signature) */}
            <div>
              <div className="mb-1 text-xs font-medium text-sub">
                conditional_function{" "}
                {gateInputs >= 2 ? (
                  <span className="text-bad">(required for multiple inputs)</span>
                ) : (
                  <span className="text-sub">(optional)</span>
                )}
              </div>
              <div className="overflow-hidden rounded-md border border-line">
                <div className="border-b border-line bg-canvas px-3 py-1.5 font-mono text-xs text-ink">
                  {gateSignature}
                </div>
                <Editor
                  height="180px"
                  defaultLanguage="python"
                  value={data.code || DEFAULT_GATE_BODY}
                  onChange={(v) => set({ code: v ?? "" })}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    scrollBeyondLastLine: false,
                    lineNumbers: "off",
                  }}
                />
              </div>
              {gateInputs >= 2 && !(data.code || "").trim() && (
                <p className="mt-1 text-[11px] text-bad">
                  Multiple inputs must be combined by your code (e.g.{" "}
                  <code>return input_1 + input_2</code>).
                </p>
              )}
              <p className="mt-1 text-[11px] text-sub">
                Each arg is a list of dict rows. Return the combined rows. The
                signature is fixed — edit the body only.
              </p>
            </div>

            {/* routing branches */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-sub">
                Branch conditions (route the result per outgoing edge)
              </div>
              {outEdges.length === 0 && (
                <p className="text-[11px] text-sub">
                  Connect this gate to downstream nodes to set branch predicates.
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
                      placeholder="e.g. price > 100 (blank = all)"
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
            </div>
          </div>
        )}

        {/* ---------------- LLM ---------------- */}
        {type === "llm" && (
          <>
            <Field label="Model">
              <input
                className={inputCls}
                placeholder="e.g. gpt-4o-mini, llama3 (blank = platform default)"
                value={data.model || ""}
                onChange={(e) => set({ model: e.target.value })}
              />
            </Field>
            <Field label="Base URL (OpenAI-compatible)">
              <input
                className={inputCls}
                placeholder="https://api.openai.com/v1"
                value={data.base_url || ""}
                onChange={(e) => set({ base_url: e.target.value })}
              />
            </Field>
            <Field label="API key">
              <input
                className={inputCls}
                type="password"
                value={data.api_key || ""}
                onChange={(e) => set({ api_key: e.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Field label="Mode">
                <select
                  className={inputCls}
                  value={data.mode || "per_row"}
                  onChange={(e) => set({ mode: e.target.value })}
                >
                  <option value="per_row">Per row (add a column)</option>
                  <option value="aggregate">Aggregate (one answer)</option>
                </select>
              </Field>
              <Field label="Max rows">
                <input
                  type="number"
                  className={inputCls}
                  value={data.max_rows ?? 20}
                  onChange={(e) => set({ max_rows: Number(e.target.value) })}
                />
              </Field>
            </div>
            {data.mode !== "aggregate" && (
              <Field label="Output column name">
                <input
                  className={inputCls}
                  placeholder="llm_output"
                  value={data.output_field || ""}
                  onChange={(e) => set({ output_field: e.target.value })}
                />
              </Field>
            )}
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
                <option value="api">REST API (POST rows)</option>
                <option value="webhook">Webhook (POST rows)</option>
                <option value="sheets">Google Sheets (Apps Script webhook)</option>
                <option value="alert">Alert (POST message + rows)</option>
                <option value="ws">WebSocket (push rows)</option>
                <option value="sse">Server-Sent Events</option>
              </select>
            </Field>
            <Field
              label={
                data.kind === "ws"
                  ? "Target ws:// URL"
                  : data.kind === "sse"
                  ? "SSE endpoint"
                  : "Target URL"
              }
            >
              <input
                className={inputCls}
                placeholder={
                  data.kind === "ws"
                    ? "wss://example.com/ingest"
                    : "https://example.com/webhook"
                }
                value={data.target || ""}
                onChange={(e) => set({ target: e.target.value })}
              />
            </Field>
            {data.kind === "alert" && (
              <Field label="Alert message">
                <input
                  className={inputCls}
                  placeholder="High-value orders detected"
                  value={data.message || ""}
                  onChange={(e) => set({ message: e.target.value })}
                />
              </Field>
            )}
            {(data.kind === "api" ||
              data.kind === "webhook" ||
              data.kind === "sheets" ||
              data.kind === "alert") && (
              <div>
                <div className="mb-1 text-xs font-medium text-sub">Headers</div>
                <KVList rows={hdrs} onChange={syncHeaders} addLabel="+ Add header" />
              </div>
            )}
            <p className="text-[11px] text-sub">
              {data.kind === "sse"
                ? "SSE needs the live streaming server; rows pass through for now."
                : "Rows are delivered on Run and also passed through so you can chain further."}
            </p>
          </>
        )}

        {msg && <div className="text-[11px] text-sub">{msg}</div>}

        {/* ---- Live preview (runs this node + its ancestors) ---- */}
        <div className="border-t border-line pt-3">
          <button
            className="btn w-full"
            onClick={loadPreview}
            disabled={previewBusy}
          >
            {previewBusy ? "Running preview…" : "Preview output"}
          </button>
          {preview &&
            (preview.empty || (preview.rows || []).length === 0 ? (
              <div className="mt-2 rounded-md border border-line bg-canvas p-3 text-xs text-sub">
                No output rows for this node with the current configuration.
              </div>
            ) : (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-sub">
                  {preview.row_count} rows
                </div>
                <div className="max-h-72 overflow-auto rounded-md border border-line">
                  <ResultsTable result={preview} />
                </div>
              </div>
            ))}
        </div>
      </div>
    </aside>
  );
}
