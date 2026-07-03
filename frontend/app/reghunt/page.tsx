"use client";

import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import Shell from "@/components/Shell";
import ResultsTable from "@/components/ResultsTable";
import SchemaCanvas from "@/components/SchemaCanvas";
import Splitter from "@/components/Splitter";
import { registerSqlCompletion } from "@/lib/sqlCompletion";
import { api } from "@/lib/api";

type Phase = "setup" | "playing" | "analysis";
type LeftTab = "challenge" | "schema" | "data";

const CREATIVITY = [
  { v: 1, label: "Low", hint: "Clear, textbook questions" },
  { v: 2, label: "Medium", hint: "Realistic, light twist" },
  { v: 3, label: "High", hint: "Creative multi-step scenarios" },
  { v: 4, label: "Great", hint: "Wild, ambitious puzzles" },
];

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function RegHunt() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [datasets, setDatasets] = useState<any[]>([]);
  const [dsKey, setDsKey] = useState("");
  const [creativity, setCreativity] = useState(2);
  const [err, setErr] = useState<string | null>(null);

  const [session, setSession] = useState<any>(null);
  const [q, setQ] = useState<any>(null);
  const [sql, setSql] = useState("-- write your query here\n");
  const [result, setResult] = useState<any>(null);
  const [submitRes, setSubmitRes] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [coach, setCoach] = useState<{ kind: string; text: string } | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [analysis, setAnalysis] = useState<any>(null);

  const [leftTab, setLeftTab] = useState<LeftTab>("challenge");
  const [mockMode, setMockMode] = useState(false);
  const [leftW, setLeftW] = useState(400);
  const [schema, setSchema] = useState<any>({ tables: [], relations: [] });
  const [dataTable, setDataTable] = useState<string | null>(null);
  const [dataResult, setDataResult] = useState<any>(null);
  const [optimizeSql, setOptimizeSql] = useState<string | null>(null);

  const schemaRef = useRef<any>({ tables: [] });
  const startMs = useRef<number>(0);

  useEffect(() => {
    api.globalDatasets().then((d) => {
      setDatasets(d);
      if (d.length) setDsKey(d[0].key);
    }).catch((e) => setErr(e.message));
  }, []);

  // server-authoritative timer: tick from the session's started_at
  useEffect(() => {
    if (phase !== "playing") return;
    const t = setInterval(() => setElapsed((Date.now() - startMs.current) / 1000), 500);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    setBusy("start");
    setErr(null);
    try {
      const s = await api.huntStart({ source: "global", key: dsKey, creativity });
      setSession(s);
      startMs.current = new Date(s.started_at).getTime();
      // load schema for autocomplete + the Schema/Data tabs
      api
        .trackSchema(s.track_id)
        .then((g) => {
          schemaRef.current = g;
          setSchema(g);
        })
        .catch(() => {});
      setPhase("playing");
      await nextQuestion(s.session_id, mockMode);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function nextQuestion(sid: number, mock = false) {
    setBusy("next");
    setResult(null);
    setSubmitRes(null);
    setCoach(null);
    setOptimizeSql(null);
    setLeftTab("challenge");
    setSql("-- write your query here\n");
    try {
      setQ(await api.huntNext(sid, mock));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function changeCreativity(v: number) {
    setCreativity(v);
    if (session) api.huntSetCreativity(session.session_id, v).catch(() => {});
  }

  async function browse(name: string) {
    setDataTable(name);
    setDataResult(null);
    try {
      setDataResult(await api.huntRun(session.session_id, `SELECT * FROM ${name} LIMIT 200`));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function revealOptimized() {
    setBusy("reveal");
    try {
      const r = await api.huntOptimizedQuery(session.session_id, q.checkpoint_id, sql);
      setOptimizeSql(r.sql);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy("run");
    try {
      setResult(await api.huntRun(session.session_id, sql));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    setCoach(null);
    try {
      const r = await api.huntSubmit(session.session_id, q.checkpoint_id, sql);
      setSubmitRes(r);
      if (r.result) setResult(r.result);
      if (r.passed && r.ask_reason) {
        setReasoning("");
        setReasonOpen(true);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function hint() {
    setBusy("hint");
    try {
      const r = await api.huntHint(session.session_id, q.checkpoint_id, sql);
      setCoach({ kind: "Hint", text: r.hint });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function optimize() {
    setBusy("optimize");
    try {
      const r = await api.huntOptimize(session.session_id, sql);
      setCoach({ kind: "Optimization", text: r.advice });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function sendReason(skip: boolean) {
    try {
      const r = await api.huntReason(
        session.session_id, q.checkpoint_id, skip ? undefined : reasoning, skip);
      setReasonOpen(false);
      if (!skip && r.feedback) setCoach({ kind: "On your approach", text: r.feedback });
    } catch {
      setReasonOpen(false);
    }
  }

  async function finish() {
    setBusy("finish");
    try {
      setAnalysis(await api.huntFinish(session.session_id));
      setPhase("analysis");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  // ---------- SETUP ----------
  if (phase === "setup") {
    const ds = datasets.find((d) => d.key === dsKey);
    return (
      <Shell>
        <div className="mx-auto max-w-2xl px-6 py-10">
          <h1 className="text-2xl font-bold">🎯 RegHunt</h1>
          <p className="mt-2 text-sm text-sub">
            An endless, adaptive SQL challenge. Pick a dataset and a creativity
            level — the AI raises the bar as you solve, timing every checkpoint so
            you can review your performance afterwards. There&apos;s no finish line;
            hunt until you choose to stop.
          </p>
          {err && <p className="mt-3 text-sm text-bad">{err}</p>}

          <div className="card mt-6 space-y-5 p-5">
            <div>
              <label className="mb-1 block text-sm font-medium">Dataset</label>
              <select
                value={dsKey}
                onChange={(e) => setDsKey(e.target.value)}
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
              >
                {datasets.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name} — {d.category} ({d.table_count} table
                    {d.table_count === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
              {ds && <p className="mt-2 text-xs text-sub">{ds.description}</p>}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                AI creativity —{" "}
                <span className="text-accent">
                  {CREATIVITY[creativity - 1].label}
                </span>
                <span className="ml-2 text-xs font-normal text-sub">
                  {CREATIVITY[creativity - 1].hint}
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={creativity}
                onChange={(e) => setCreativity(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="mt-1 flex justify-between text-[11px] text-sub">
                {CREATIVITY.map((c) => (
                  <span
                    key={c.v}
                    className={creativity === c.v ? "font-semibold text-ink" : ""}
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-sub">
              <input
                type="checkbox"
                checked={mockMode}
                onChange={(e) => setMockMode(e.target.checked)}
              />
              🧪 Test mode — start with a fixed sample question (best on
              Northwind)
            </label>

            <button
              className="btn btn-primary w-full"
              onClick={start}
              disabled={busy === "start" || !dsKey}
            >
              {busy === "start" ? "Spinning up your hunt…" : "Start the hunt →"}
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ---------- ANALYSIS ----------
  if (phase === "analysis" && analysis) {
    return (
      <Shell>
        <div className="mx-auto max-w-4xl px-6 py-8">
          <h1 className="text-2xl font-bold">Hunt report — {analysis.dataset_name}</h1>
          <p className="mt-1 text-sm text-sub">
            {analysis.total_questions} challenges · {analysis.solved} solved ·
            creativity {CREATIVITY[analysis.creativity - 1].label.toLowerCase()}
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Accuracy", `${analysis.accuracy}%`],
              ["Solved", `${analysis.solved}/${analysis.answered}`],
              ["Peak difficulty", `${analysis.peak_difficulty}/5`],
              ["Active time", fmt(analysis.active_seconds)],
              ["Avg / question", `${analysis.avg_seconds}s`],
              ["Hints used", analysis.hints_used],
              ["Optimizations", analysis.optimizations],
              ["Reasons given", analysis.reasons_given],
            ].map(([k, v]) => (
              <div key={k as string} className="card p-4">
                <div className="text-xs text-sub">{k}</div>
                <div className="mt-1 text-xl font-semibold">{v as any}</div>
              </div>
            ))}
          </div>

          {/* difficulty + pass/fail timeline */}
          <div className="card mt-6 p-5">
            <h3 className="mb-3 text-sm font-semibold">Difficulty & outcomes over time</h3>
            <div className="flex items-end gap-1.5" style={{ height: 140 }}>
              {analysis.timeline.map((t: any) => (
                <div
                  key={t.seq}
                  title={`#${t.seq} · diff ${t.difficulty}/5 · ${
                    t.passed ? "solved" : t.passed === false ? "missed" : "unanswered"
                  } · ${t.seconds}s\n${t.prompt}`}
                  className="flex-1"
                  style={{
                    height: `${(t.difficulty / 5) * 100}%`,
                    minWidth: 8,
                    borderRadius: 3,
                    background:
                      t.passed === true
                        ? "var(--ok, #16a34a)"
                        : t.passed === false
                        ? "var(--warn, #dc2626)"
                        : "var(--line, #d1d5db)",
                    opacity: 0.85,
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-sub">
              <span>bar height = difficulty (1–5)</span>
              <span className="text-ok">■ solved</span>
              <span className="text-bad">■ missed</span>
            </div>
          </div>

          {/* skills */}
          {analysis.skills.length > 0 && (
            <div className="card mt-4 p-5">
              <h3 className="mb-3 text-sm font-semibold">Skills exercised</h3>
              <div className="space-y-2">
                {analysis.skills.map((s: any) => (
                  <div key={s.skill} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 text-sm">{s.skill}</div>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-canvas">
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${(s.solved / s.seen) * 100}%` }}
                      />
                    </div>
                    <div className="w-16 shrink-0 text-right text-xs text-sub">
                      {s.solved}/{s.seen}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* reasoning analytics — this hunt + across previous hunts */}
          {analysis.lifetime && (
            <div className="card mt-4 p-5">
              <h3 className="mb-1 text-sm font-semibold">Reasoning insight</h3>
              <p className="text-xs text-sub">
                Across {analysis.lifetime.total_hunts} hunt
                {analysis.lifetime.total_hunts === 1 ? "" : "s"} you explained your
                approach on{" "}
                <span className="font-semibold text-ink">
                  {analysis.lifetime.reason_rate}%
                </span>{" "}
                of multi-solution wins ({analysis.lifetime.reasons_given}/
                {analysis.lifetime.reason_opportunities}). Lifetime accuracy{" "}
                <span className="font-semibold text-ink">
                  {analysis.lifetime.accuracy}%
                </span>{" "}
                over {analysis.lifetime.answered} answered.
              </p>
              {analysis.lifetime.recent_reasonings?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {analysis.lifetime.recent_reasonings.map((r: any, i: number) => (
                    <div
                      key={i}
                      className="rounded-md border border-line bg-canvas p-2 text-xs"
                    >
                      <div className="text-sub">{r.prompt}…</div>
                      <div className="mt-0.5 italic text-ink">“{r.reasoning}”</div>
                    </div>
                  ))}
                </div>
              )}
              {analysis.lifetime.recent_reasonings?.length === 0 && (
                <p className="mt-2 text-xs text-sub">
                  You haven&apos;t shared reasoning yet — on multi-solution
                  challenges, explaining your choice builds sharper judgement.
                </p>
              )}
            </div>
          )}

          <button
            className="btn btn-primary mt-6"
            onClick={() => {
              setPhase("setup");
              setSession(null);
              setAnalysis(null);
              setElapsed(0);
            }}
          >
            New hunt
          </button>
        </div>
      </Shell>
    );
  }

  // ---------- PLAYING ----------
  return (
    <Shell>
      <div className="flex h-screen flex-col">
        <div className="flex items-center justify-between border-b border-line bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold">🎯 RegHunt</h1>
            <span className="tag">{session?.dataset_name}</span>
            {q && (
              <>
                <span className="tag">#{q.seq}</span>
                <span className="tag border-accent/30 bg-accent/10 text-accent">
                  difficulty {q.difficulty}/5
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm tabular-nums" title="Session time">
              ⏱ {fmt(elapsed)}
            </span>
            <button className="btn" onClick={finish} disabled={busy === "finish"}>
              {busy === "finish" ? "Wrapping up…" : "Finish hunt"}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* left: challenge + coaching */}
          <aside
            style={{ width: leftW }}
            className="flex shrink-0 flex-col border-r border-line bg-white"
          >
            {/* tabs */}
            <div className="flex items-center gap-1 border-b border-line px-3">
              {(["challenge", "schema", "data"] as LeftTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setLeftTab(t)}
                  className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                    leftTab === t
                      ? "border-accent text-ink"
                      : "border-transparent text-sub hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              {/* schema stays mounted (hidden off-tab) so pan/zoom persist */}
              <div className={leftTab === "schema" ? "h-full" : "hidden"}>
                <SchemaCanvas
                  tables={schema.tables}
                  relations={schema.relations}
                  storageKey={`reghunt_schema_${session?.track_id}`}
                />
              </div>
              {leftTab !== "schema" && (
                <div className="h-full overflow-auto p-5">
                  {leftTab === "data" ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {schema.tables.map((t: any) => (
                          <button
                            key={t.name}
                            onClick={() => browse(t.name)}
                            className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                              dataTable === t.name
                                ? "border-accent bg-accent text-white"
                                : "border-line text-ink hover:bg-canvas"
                            }`}
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
                        ))}
                      </div>
                      {dataTable ? (
                        <div className="mt-3">
                          <ResultsTable result={dataResult} />
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-sub">
                          Pick a table to browse its rows (first 200).
                        </p>
                      )}
                    </>
                  ) : busy === "next" ? (
                    <p className="text-sm text-sub">Crafting your next challenge…</p>
                  ) : q ? (
                    <>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {(q.skills || []).map((s: string) => (
                          <span key={s} className="tag">{s}</span>
                        ))}
                        {q.multi_solution && (
                          <span className="tag border-accent/30 text-accent">
                            many valid solutions
                          </span>
                        )}
                      </div>
                      <div className="rounded-lg border border-line bg-canvas p-4 text-sm leading-relaxed">
                        {q.prompt}
                      </div>
                      <div className="mt-3">
                        <button className="btn" onClick={hint} disabled={!!busy}>
                          {busy === "hint" ? "…" : "💡 Hint"}
                        </button>
                      </div>

                      {coach && (
                        <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm">
                          <div className="mb-1 text-xs font-semibold text-accent">
                            {coach.kind}
                          </div>
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {coach.text}
                          </div>
                        </div>
                      )}

                      {submitRes && (
                        <div
                          className={`mt-4 rounded-lg border p-3 text-sm ${
                            submitRes.passed
                              ? "border-ok/40 bg-ok/10"
                              : "border-warn/40 bg-warn/10"
                          }`}
                        >
                          {submitRes.passed ? (
                            <>
                              <div className="font-semibold text-ok">
                                ✓ Solved — score {submitRes.score}/100
                              </div>

                              {submitRes.optimize_challenge && (
                                <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-3">
                                  <div className="text-xs font-semibold text-accent">
                                    ⚡ Optimization round
                                  </div>
                                  <p className="mt-1 text-xs text-sub">
                                    Nice work. Now — can you make this query faster or
                                    cleaner? Edit it in the editor, then get a review.
                                    Stuck? Reveal an optimized version.
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      className="btn !py-1"
                                      onClick={optimize}
                                      disabled={!!busy}
                                    >
                                      {busy === "optimize" ? "…" : "Review my optimization"}
                                    </button>
                                    <button
                                      className="btn !py-1"
                                      onClick={revealOptimized}
                                      disabled={!!busy}
                                    >
                                      {busy === "reveal" ? "…" : "Reveal optimized query"}
                                    </button>
                                  </div>
                                  {optimizeSql && (
                                    <div className="mt-2">
                                      <div className="mb-1 text-[11px] text-sub">
                                        Optimized query (click to load into editor):
                                      </div>
                                      <pre
                                        onClick={() => setSql(optimizeSql)}
                                        className="cursor-pointer overflow-auto rounded bg-ink/5 p-2 font-mono text-[11px] leading-snug"
                                      >
                                        {optimizeSql}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}

                              <button
                                className="btn btn-primary mt-3"
                                onClick={() => nextQuestion(session.session_id)}
                                disabled={!!busy}
                              >
                                Next challenge →
                              </button>
                            </>
                          ) : (
                            <div>
                              <div className="font-semibold text-bad">
                                {submitRes.error
                                  ? `Query error: ${submitRes.error}`
                                  : "Not quite — match the expected result below."}
                              </div>
                              {!submitRes.error &&
                                submitRes.expected_columns?.length > 0 && (
                                  <div className="mt-2">
                                    <div className="mb-1 text-[11px] text-sub">
                                      Expected: {submitRes.expected_rows} row
                                      {submitRes.expected_rows === 1 ? "" : "s"} · columns{" "}
                                      <span className="font-mono">
                                        {submitRes.expected_columns.join(", ")}
                                      </span>
                                    </div>
                                    <div className="max-h-52 overflow-auto rounded border border-line bg-white">
                                      <table className="w-full text-left text-[11px]">
                                        <thead className="bg-canvas text-sub">
                                          <tr>
                                            {submitRes.expected_columns.map((c: string) => (
                                              <th key={c} className="px-2 py-1 font-mono font-medium">
                                                {c}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(submitRes.expected_preview || []).map(
                                            (row: any, i: number) => (
                                              <tr key={i} className="border-t border-line">
                                                {submitRes.expected_columns.map((c: string) => (
                                                  <td key={c} className="px-2 py-1 font-mono">
                                                    {String(row[c] ?? "")}
                                                  </td>
                                                ))}
                                              </tr>
                                            )
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                    <p className="mt-1 text-[11px] text-sub">
                                      A preview of the correct result — match its
                                      columns and rows.
                                    </p>
                                  </div>
                                )}
                            </div>
                          )}
                        </div>
                      )}
                      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
                    </>
                  ) : (
                    <p className="text-sm text-sub">No challenge yet.</p>
                  )}
                </div>
              )}
            </div>

            {/* AI creativity slider — bottom left, adjustable mid-hunt */}
            <div className="border-t border-line px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-sub">AI creativity</span>
                <span className="text-xs font-semibold text-accent">
                  {CREATIVITY[creativity - 1].label}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={4}
                step={1}
                value={creativity}
                onChange={(e) => changeCreativity(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-sub">
                {CREATIVITY.map((c) => (
                  <span
                    key={c.v}
                    className={creativity === c.v ? "font-semibold text-ink" : ""}
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          </aside>

          <Splitter
            axis="x"
            onDelta={(d) => setLeftW((w) => Math.max(300, Math.min(720, w + d)))}
          />

          {/* right: editor + results */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-line bg-canvas px-3 py-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-sub">
                SQL Editor
              </span>
              <div className="flex gap-2">
                <button className="btn !py-1" onClick={run} disabled={!!busy}>
                  {busy === "run" ? "Running…" : "▶ Run"}
                </button>
                <button
                  className="btn btn-primary !py-1"
                  onClick={submit}
                  disabled={!!busy || !q}
                >
                  {busy === "submit" ? "Checking…" : "Submit"}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 border-b border-line">
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs"
                value={sql}
                onChange={(v) => setSql(v ?? "")}
                onMount={(_e, monaco) =>
                  registerSqlCompletion(monaco, () => schemaRef.current)
                }
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 12 },
                }}
              />
            </div>
            <div className="h-[280px] overflow-auto">
              <ResultsTable result={result} />
            </div>
          </section>
        </div>
      </div>

      {/* reasoning modal (multi-solution wins) */}
      {reasonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-semibold">Nice — why this approach?</h3>
            <p className="mt-1 text-xs text-sub">
              This challenge had several valid solutions. Briefly, why did you pick
              yours? (Totally optional.)
            </p>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={4}
              placeholder="e.g. a CTE reads cleaner than a nested subquery here…"
              className="mt-3 w-full resize-none rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn" onClick={() => sendReason(true)}>
                Skip
              </button>
              <button
                className="btn btn-primary"
                onClick={() => sendReason(false)}
                disabled={!reasoning.trim()}
              >
                Share reasoning
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
