"use client";

import Editor from "@monaco-editor/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Shell from "@/components/Shell";
import { Difficulty } from "@/components/ui";
import ResultsTable from "@/components/ResultsTable";
import RunningState from "@/components/RunningState";
import MentorPanel from "@/components/MentorPanel";
import SchemaCanvas from "@/components/SchemaCanvas";
import Splitter from "@/components/Splitter";
import { PanelToggle, PanelGlyph } from "@/components/PanelToggle";
import { api } from "@/lib/api";
import { registerSqlCompletion } from "@/lib/sqlCompletion";

type Tab = "results" | "plan" | "evaluation" | "history";
type LeftTab = "incident" | "schema" | "data";
type RightTab = "chat" | "review";
type QueryTab = { id: string; name: string; sql: string };

function walkPlan(node: any, depth = 0, out: any[] = []) {
  out.push({ depth, node });
  (node?.Plans || []).forEach((c: any) => walkPlan(c, depth + 1, out));
  return out;
}

const newId = () => Math.random().toString(36).slice(2, 9);

export default function ScenarioPage() {
  const { key } = useParams<{ key: string }>();
  const [data, setData] = useState<any>(null);

  // Query tabs (LeetCode-style multi-editor)
  const [tabs, setTabs] = useState<QueryTab[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  // Adjustable panels (Cursor-style)
  const [showBrief, setShowBrief] = useState(true);
  const [showMentor, setShowMentor] = useState(true);
  const [leftTab, setLeftTab] = useState<LeftTab>("incident");
  const [rightTab, setRightTab] = useState<RightTab>("chat");

  // Resizable panel sizes (IDE-style draggable dividers), in px
  const [briefW, setBriefW] = useState(320);
  const [mentorW, setMentorW] = useState(384);
  const [outputH, setOutputH] = useState(300);
  const [schema, setSchema] = useState<any>({ tables: [], relations: [] });
  const schemaRef = useRef<any>({ tables: [] });
  const completionRef = useRef<{ dispose: () => void } | null>(null);
  const [dataTable, setDataTable] = useState<string | null>(null);
  const [dataResult, setDataResult] = useState<any>(null);
  const [dataBusy, setDataBusy] = useState(false);

  const [result, setResult] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>("results");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tabsKey = `sqlforge_tabs_${key}`;
  const shortcutsRef = useRef<{
    run: () => void;
    submit: () => void;
    togglePanel: (which: "brief" | "mentor") => void;
  } | null>(null);

  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);
  useEffect(() => () => completionRef.current?.dispose(), []);

  useEffect(() => {
    setShowBrief(localStorage.getItem("sqlforge_panel_brief") !== "0");
    setShowMentor(localStorage.getItem("sqlforge_panel_mentor") !== "0");
    const num = (k: string, d: number) => {
      const v = parseInt(localStorage.getItem(k) || "", 10);
      return Number.isFinite(v) ? v : d;
    };
    setBriefW(num("sqlforge_briefW", 320));
    setMentorW(num("sqlforge_mentorW", 384));
    setOutputH(num("sqlforge_outputH", 300));
  }, []);

  useEffect(() => {
    localStorage.setItem("sqlforge_briefW", String(briefW));
  }, [briefW]);
  useEffect(() => {
    localStorage.setItem("sqlforge_mentorW", String(mentorW));
  }, [mentorW]);
  useEffect(() => {
    localStorage.setItem("sqlforge_outputH", String(outputH));
  }, [outputH]);

  useEffect(() => {
    shortcutsRef.current = { run, submit, togglePanel };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const actions = shortcutsRef.current;
      if (!actions) return;
      switch (e.key) {
        case "'":
          e.preventDefault();
          actions.run();
          break;
        case "Enter":
          e.preventDefault();
          actions.submit();
          break;
        case "[":
          e.preventDefault();
          e.stopPropagation();
          actions.togglePanel("brief");
          break;
        case "]":
          e.preventDefault();
          e.stopPropagation();
          actions.togglePanel("mentor");
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    api
      .scenario(key)
      .then((d) => {
        setData(d);
        // restore saved query tabs, else seed from starter SQL
        let restored: QueryTab[] | null = null;
        try {
          const raw = localStorage.getItem(tabsKey);
          if (raw) restored = JSON.parse(raw);
        } catch {
          /* noop */
        }
        if (restored && restored.length) {
          setTabs(restored);
          setActiveId(restored[0].id);
        } else {
          const t = {
            id: newId(),
            name: "Query 1",
            sql: d.scenario.starter_sql || "",
          };
          setTabs([t]);
          setActiveId(t.id);
        }
      })
      .catch((e) => setErr(e.message));
    api
      .scenarioSchema(key)
      .then(setSchema)
      .catch((e) => setErr(e.message));
  }, [key]);

  // persist tabs
  useEffect(() => {
    if (tabs.length) localStorage.setItem(tabsKey, JSON.stringify(tabs));
  }, [tabs, tabsKey]);

  const scenario = data?.scenario;
  const progress = data?.progress;
  const activeTab = tabs.find((t) => t.id === activeId) || tabs[0];
  const sql = activeTab?.sql ?? "";

  function setSql(v: string) {
    setTabs((ts) => ts.map((t) => (t.id === activeId ? { ...t, sql: v } : t)));
  }

  function addTab() {
    const n = tabs.length + 1;
    const t = { id: newId(), name: `Query ${n}`, sql: "" };
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
  }

  function closeTab(id: string) {
    setTabs((ts) => {
      if (ts.length === 1) return ts; // keep at least one
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (id === activeId) {
        const fallback = next[Math.max(0, idx - 1)];
        setActiveId(fallback.id);
      }
      return next;
    });
  }

  function togglePanel(which: "brief" | "mentor") {
    if (which === "brief") {
      setShowBrief((s) => {
        localStorage.setItem("sqlforge_panel_brief", s ? "0" : "1");
        return !s;
      });
    } else {
      setShowMentor((s) => {
        localStorage.setItem("sqlforge_panel_mentor", s ? "0" : "1");
        return !s;
      });
    }
  }

  async function loadTable(name: string) {
    setDataTable(name);
    setDataBusy(true);
    setErr(null);
    try {
      setDataResult(await api.run(key, `SELECT * FROM ${name} LIMIT 200`));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDataBusy(false);
    }
  }

  const planRows = useMemo(() => {
    if (!plan?.ok || !plan.plan) return [];
    const root = Array.isArray(plan.plan) ? plan.plan[0].Plan : plan.plan.Plan;
    return walkPlan(root);
  }, [plan]);

  async function refreshHistory() {
    try {
      setHistory(await api.history(key));
    } catch {
      /* noop */
    }
  }

  async function run() {
    setBusy("run");
    setErr(null);
    setTab("results"); // switch to Results immediately so the state change is visible
    try {
      const r = await api.run(key, sql);
      setResult(r);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function explain() {
    setBusy("explain");
    setErr(null);
    try {
      const p = await api.explain(key, sql, true);
      setPlan(p);
      setTab("plan");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    setErr(null);
    try {
      const ev = await api.submit(key, sql);
      setEvaluation(ev);
      setTab("evaluation");
      setRightTab("review");
      setShowMentor(true);
      localStorage.setItem("sqlforge_panel_mentor", "1");
      if (ev.result) setResult(ev.result);
      const d = await api.scenario(key);
      setData(d);
      refreshHistory();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    try {
      const r = await api.reset(key);
      setNotice(r.message);
      setResult(null);
      setPlan(null);
      setTimeout(() => setNotice(null), 4000);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (!scenario) {
    return (
      <Shell>
        <div className="p-8 text-sm text-sub">
          {err ? <span className="text-bad">{err}</span> : "Loading incident…"}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex h-screen flex-col">
        {/* Incident header */}
        <div className="flex items-center justify-between gap-4 border-b border-line bg-white px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/paths" className="text-sm text-sub hover:text-ink">
              ← Incidents
            </Link>
            <span className="text-line">/</span>
            <h1 className="truncate text-sm font-semibold">{scenario.title}</h1>
            <span className="tag shrink-0">{scenario.path}</span>
            <Difficulty level={progress?.difficulty || scenario.difficulty} />
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            {progress?.best_score > 0 && (
              <span className="text-sub">
                Best score{" "}
                <span className="font-semibold text-ink">
                  {progress.best_score}
                </span>
              </span>
            )}
            {/* Cursor-style panel toggles */}
            <div className="flex items-center gap-1 rounded-md border border-line p-0.5">
              <PanelToggle
                side="left"
                active={showBrief}
                onClick={() => togglePanel("brief")}
                title="Toggle incident / schema / data panel"
              />
              <PanelToggle
                side="right"
                active={showMentor}
                onClick={() => togglePanel("mentor")}
                title="Toggle AI mentor panel"
              />
            </div>
            <button
              className="btn"
              onClick={reset}
              disabled={busy === "reset"}
              title="Reset the sandbox data and indexes to the initial broken state"
            >
              {busy === "reset" ? "Resetting…" : "Reset sandbox"}
            </button>
          </div>
        </div>

        {notice && (
          <div className="border-b border-ok/30 bg-ok/10 px-6 py-2 text-sm text-ok">
            {notice}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* Briefing */}
          {showBrief && (
            <aside
              style={{ width: briefW }}
              className="flex shrink-0 flex-col overflow-hidden border-r border-line bg-white"
            >
              <div className="flex items-center gap-1 border-b border-line px-3">
                {(["incident", "schema", "data"] as LeftTab[]).map((t) => (
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

              {leftTab === "incident" && (
                <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
                  <Section title="Incident">
                    <p className="text-sm leading-relaxed text-ink">
                      {scenario.story}
                    </p>
                  </Section>
                  <Section title="Objectives">
                    <ul className="space-y-1.5">
                      {scenario.objectives.map((o: string, i: number) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span className="text-sub">{i + 1}.</span>
                          {o}
                        </li>
                      ))}
                    </ul>
                  </Section>
                  <Section title="Constraints">
                    <ul className="space-y-1.5">
                      {scenario.constraints.map((c: string, i: number) => (
                        <li key={i} className="flex gap-2 text-sm text-sub">
                          <span>•</span>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </Section>
                  <Section title="Tables">
                    <div className="flex flex-wrap gap-1.5">
                      {scenario.tables.map((t: string) => (
                        <button
                          key={t}
                          className="tag font-mono hover:bg-canvas"
                          onClick={() => {
                            setLeftTab("data");
                            loadTable(t);
                          }}
                          title={`Browse ${t}`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </Section>
                  <Section title="Success criteria">
                    <p className="text-sm text-sub">{scenario.success_criteria}</p>
                  </Section>
                </div>
              )}

              {leftTab === "schema" && (
                <div className="min-h-0 flex-1">
                  <SchemaCanvas
                    tables={schema.tables}
                    relations={schema.relations}
                    storageKey={`sqlforge_incident_schema_pos_${key}`}
                  />
                </div>
              )}

              {leftTab === "data" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex flex-wrap gap-1.5 border-b border-line p-3">
                    {(schema.tables.length ? schema.tables : scenario.tables.map((name: string) => ({ name, row_count: "" }))).map((t: any) => (
                      <button
                        key={t.name}
                        onClick={() => loadTable(t.name)}
                        className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                          dataTable === t.name
                            ? "border-accent bg-accent text-white"
                            : "border-line bg-white text-ink hover:bg-canvas"
                        }`}
                        title={t.row_count !== "" ? `${t.row_count} rows` : `Browse ${t.name}`}
                      >
                        {t.name}
                        {t.row_count !== "" && (
                          <span className={`ml-1.5 ${dataTable === t.name ? "text-white/70" : "text-sub"}`}>
                            {t.row_count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    {!dataTable ? (
                      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-sub">
                        Pick a table to browse its rows (first 200).
                      </div>
                    ) : dataBusy ? (
                      <div className="p-4 text-sm text-sub">Loading {dataTable}…</div>
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
          )}
          {showBrief && (
            <Splitter
              axis="x"
              onDelta={(d) =>
                setBriefW((w) => Math.max(220, Math.min(560, w + d)))
              }
            />
          )}

          {/* Workbench */}
          <section className="flex min-w-0 flex-1 flex-col">
            {/* Query tabs */}
            <div className="flex items-center gap-1 border-b border-line bg-canvas px-2">
              {!showBrief && (
                <button
                  onClick={() => togglePanel("brief")}
                  title="Show briefing"
                  className="mr-1 flex h-7 w-7 items-center justify-center rounded text-sub hover:bg-white hover:text-ink"
                >
                  <PanelGlyph side="left" active={false} />
                </button>
              )}
              <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
                {tabs.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setActiveId(t.id)}
                    className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-line px-3 py-2 text-xs ${
                      t.id === activeId
                        ? "bg-white font-medium text-ink"
                        : "text-sub hover:bg-white/60"
                    }`}
                  >
                    <span className="font-mono">{t.name}</span>
                    {tabs.length > 1 && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        className="flex h-4 w-4 items-center justify-center rounded text-sub opacity-0 hover:bg-line hover:text-ink group-hover:opacity-100"
                      >
                        ×
                      </span>
                    )}
                  </div>
                ))}
                <button
                  onClick={addTab}
                  title="New query tab"
                  className="flex h-7 w-7 shrink-0 items-center justify-center text-sub hover:text-ink"
                >
                  +
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-2 px-2 py-1">
                <button className="btn !py-1" onClick={run} disabled={!!busy}>
                  {busy === "run" ? "Running…" : "▶ Run"}
                </button>
                <button className="btn !py-1" onClick={explain} disabled={!!busy}>
                  {busy === "explain" ? "…" : "Explain"}
                </button>
                <button
                  className="btn btn-primary !py-1"
                  onClick={submit}
                  disabled={!!busy}
                >
                  {busy === "submit" ? "Evaluating…" : "Submit for review"}
                </button>
              </div>
              {!showMentor && (
                <button
                  onClick={() => togglePanel("mentor")}
                  title="Show AI mentor"
                  className="ml-1 flex h-7 w-7 items-center justify-center rounded text-sub hover:bg-white hover:text-ink"
                >
                  <PanelGlyph side="right" active={false} />
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 border-b border-line">
              <Editor
                height="100%"
                path={activeId}
                defaultLanguage="sql"
                theme="vs"
                value={sql}
                onChange={(v) => setSql(v ?? "")}
                onMount={(_editor, monaco) => {
                  completionRef.current?.dispose();
                  completionRef.current = registerSqlCompletion(
                    monaco,
                    () => schemaRef.current
                  );
                }}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 12 },
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  renderLineHighlight: "none",
                  overviewRulerLanes: 0,
                  quickSuggestions: { other: true, comments: false, strings: false },
                  suggestOnTriggerCharacters: true,
                }}
              />
            </div>

            {/* Output */}
            <Splitter
              axis="y"
              onDelta={(d) =>
                setOutputH((h) => Math.max(120, Math.min(720, h - d)))
              }
            />
            <div
              style={{ height: outputH }}
              className="flex min-h-0 shrink-0 flex-col bg-white"
            >
              <div className="flex items-center gap-1 border-b border-line px-3">
                {(["results", "plan", "evaluation", "history"] as Tab[]).map(
                  (t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                        tab === t
                          ? "border-accent text-ink"
                          : "border-transparent text-sub hover:text-ink"
                      }`}
                    >
                      {t}
                    </button>
                  )
                )}
                <div className="ml-auto py-2 pr-1 text-xs text-sub">
                  {busy === "run" && tab === "results" ? (
                    <span className="text-accent">running…</span>
                  ) : (
                    result?.ok &&
                    tab === "results" && (
                      <span>
                        {result.row_count} rows · {result.duration_ms} ms
                      </span>
                    )
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {err && (
                  <div className="m-3 rounded-md border border-bad/30 bg-bad/5 p-2 text-xs text-bad">
                    {err}
                  </div>
                )}
                {tab === "results" &&
                  (busy === "run" ? <RunningState /> : <ResultsTable result={result} />)}
                {tab === "plan" && <PlanView plan={plan} rows={planRows} />}
                {tab === "evaluation" && (
                  <EvaluationView evaluation={evaluation} />
                )}
                {tab === "history" && <HistoryView history={history} />}
              </div>
            </div>
          </section>

          {/* Mentor */}
          {showMentor && (
            <Splitter
              axis="x"
              onDelta={(d) =>
                setMentorW((w) => Math.max(280, Math.min(620, w - d)))
              }
            />
          )}
          {showMentor && (
            <aside
              style={{ width: mentorW }}
              className="flex min-h-0 shrink-0 flex-col border-l border-line bg-white"
            >
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
                  AI
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold leading-none">
                    AI Mentor
                  </div>
                  <div className="mt-0.5 text-xs text-sub">
                    Conversation &amp; incident review
                  </div>
                </div>
                <button
                  onClick={() => togglePanel("mentor")}
                  title="Close AI panel"
                  className="ml-auto flex h-6 w-6 items-center justify-center rounded text-sub hover:bg-canvas hover:text-ink"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-1 border-b border-line px-3">
                {(["chat", "review"] as RightTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRightTab(t)}
                    className={`relative border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                      rightTab === t
                        ? "border-accent text-ink"
                        : "border-transparent text-sub hover:text-ink"
                    }`}
                  >
                    {t}
                    {t === "review" && evaluation && (
                      <span
                        className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                          evaluation.passed ? "bg-ok" : "bg-warn"
                        }`}
                      />
                    )}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1">
                <div className={rightTab === "chat" ? "h-full" : "hidden"}>
                  <MentorPanel
                    scenarioKey={key}
                    currentSql={sql}
                    lastResult={result}
                    hideHeader
                  />
                </div>
                <div
                  className={
                    rightTab === "review" ? "h-full overflow-auto" : "hidden"
                  }
                >
                  <EvaluationView evaluation={evaluation} />
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">
        {title}
      </h3>
      {children}
    </div>
  );
}

function PlanView({ plan, rows }: { plan: any; rows: any[] }) {
  if (!plan)
    return (
      <div className="flex h-full items-center justify-center text-sm text-sub">
        Hit “Explain” to see the execution plan.
      </div>
    );
  if (!plan.ok)
    return (
      <div className="m-3 rounded-md border border-bad/30 bg-bad/5 p-2 font-mono text-xs text-bad">
        {plan.error}
      </div>
    );
  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-sub">
            <th className="py-1 pr-2 font-medium">Node</th>
            <th className="py-1 pr-2 font-medium">Relation</th>
            <th className="py-1 pr-2 text-right font-medium">Est. rows</th>
            <th className="py-1 pr-2 text-right font-medium">Actual ms</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ depth, node }, i) => {
            const isSeq = node["Node Type"] === "Seq Scan";
            return (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2" style={{ paddingLeft: depth * 14 }}>
                  <span
                    className={`font-mono ${
                      isSeq ? "font-semibold text-bad" : "text-ink"
                    }`}
                  >
                    {node["Node Type"]}
                  </span>
                </td>
                <td className="py-1 pr-2 font-mono text-sub">
                  {node["Relation Name"] || ""}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-sub">
                  {node["Plan Rows"]}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-sub">
                  {node["Actual Total Time"] != null
                    ? node["Actual Total Time"].toFixed(2)
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r.node["Node Type"] === "Seq Scan") && (
        <p className="mt-3 text-xs text-warn">
          A sequential scan reads every row in the table — often the smoking gun
          when a query is slow on a large table.
        </p>
      )}
    </div>
  );
}

function ScoreRing({ score, passed }: { score: number; passed: boolean }) {
  const color = passed ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  return (
    <div
      className="relative flex h-20 w-20 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${color} ${score * 3.6}deg, #e7e8ec 0deg)`,
      }}
    >
      <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white">
        <span className="text-lg font-semibold tabular-nums">{score}</span>
        <span className="text-[10px] text-sub">/ 100</span>
      </div>
    </div>
  );
}

function EvaluationView({ evaluation }: { evaluation: any }) {
  if (!evaluation)
    return (
      <div className="flex h-full items-center justify-center text-sm text-sub">
        Submit your solution to get a senior review.
      </div>
    );
  if (evaluation.ok === false) {
    return (
      <div className="p-4">
        <p className="text-sm font-medium text-bad">
          {evaluation.feedback?.summary || "Your SQL didn't run."}
        </p>
        {(evaluation.feedback?.recommendations || []).map(
          (r: string, i: number) => (
            <p key={i} className="mt-1 font-mono text-xs text-sub">
              {r}
            </p>
          )
        )}
      </div>
    );
  }
  const fb = evaluation.feedback || {};
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-4">
        <ScoreRing score={evaluation.score} passed={evaluation.passed} />
        <div className="flex-1">
          <div
            className={`text-sm font-semibold ${
              evaluation.passed ? "text-ok" : "text-warn"
            }`}
          >
            {evaluation.passed ? "Incident resolved ✓" : "Not passing yet"}
          </div>
          <p className="mt-1 text-sm text-ink">{fb.summary}</p>
          {evaluation.passed && evaluation.next_recommendation && (
            <Link
              href={`/scenario/${evaluation.next_recommendation}`}
              className="mt-2 inline-block text-sm font-medium text-accent"
            >
              Next incident: {evaluation.next_recommendation} →
            </Link>
          )}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-sub">
          Automated checks
        </h4>
        <div className="space-y-1.5">
          {evaluation.checks.map((c: any, i: number) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-line p-2 text-sm"
            >
              <span className={c.passed ? "text-ok" : "text-bad"}>
                {c.passed ? "✓" : "✕"}
              </span>
              <div>
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-sub">{c.detail}</div>
              </div>
              <span className="ml-auto text-xs text-sub">{c.weight}%</span>
            </div>
          ))}
        </div>
      </div>

      {fb.strengths?.length > 0 && (
        <FeedbackList title="What went well" items={fb.strengths} tone="ok" />
      )}
      {fb.recommendations?.length > 0 && (
        <FeedbackList
          title="Recommendations"
          items={fb.recommendations}
          tone="warn"
        />
      )}
    </div>
  );
}

function FeedbackList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "ok" | "warn";
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
        {title}
      </h4>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={tone === "ok" ? "text-ok" : "text-warn"}>
              {tone === "ok" ? "•" : "→"}
            </span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryView({ history }: { history: any[] }) {
  if (!history.length)
    return (
      <div className="flex h-full items-center justify-center text-sm text-sub">
        Your query runs for this incident will appear here.
      </div>
    );
  return (
    <div className="divide-y divide-line">
      {history.map((h, i) => (
        <div key={i} className="px-3 py-2">
          <div className="flex items-center justify-between text-xs text-sub">
            <span className={h.success ? "text-ok" : "text-bad"}>
              {h.success ? "success" : "error"}
            </span>
            <span className="tabular-nums">
              {h.duration_ms} ms · {h.row_count ?? 0} rows
            </span>
          </div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-ink">
            {h.sql}
          </pre>
          {h.error && (
            <div className="mt-1 font-mono text-[11px] text-bad">{h.error}</div>
          )}
        </div>
      ))}
    </div>
  );
}
