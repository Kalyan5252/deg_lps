"use client";

import Editor from "@monaco-editor/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Difficulty } from "@/components/ui";
import ResultsTable from "@/components/ResultsTable";
import RunningState from "@/components/RunningState";
import SchemaCanvas from "@/components/SchemaCanvas";
import TrackMentorChat from "@/components/TrackMentorChat";
import Splitter from "@/components/Splitter";
import { PanelToggle, PanelGlyph } from "@/components/PanelToggle";
import { api } from "@/lib/api";

type LeftTab = "question" | "schema" | "data";
type RightTab = "chat" | "review";

export default function TrackWorkbench() {
  const { id } = useParams<{ id: string }>();
  const [track, setTrack] = useState<any>(null);
  const [schema, setSchema] = useState<any>({ tables: [], relations: [] });
  const [leftTab, setLeftTab] = useState<LeftTab>("question");
  const [rightTab, setRightTab] = useState<RightTab>("chat");

  const [question, setQuestion] = useState<any>(null);
  const [sql, setSql] = useState("-- write your query here\n");
  const [result, setResult] = useState<any>(null);
  const [evalResult, setEvalResult] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [serverUp, setServerUp] = useState(false);

  const [leftW, setLeftW] = useState(360);
  const [rightW, setRightW] = useState(384);
  const [outputH, setOutputH] = useState(280);

  // adjustable panels (Cursor-style show/hide)
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);

  // dataset browser
  const [dataTable, setDataTable] = useState<string | null>(null);
  const [dataResult, setDataResult] = useState<any>(null);
  const [dataBusy, setDataBusy] = useState(false);

  useEffect(() => {
    const num = (k: string, setter: (n: number) => void) => {
      const n = parseInt(localStorage.getItem(k) || "", 10);
      if (Number.isFinite(n)) setter(n);
    };
    num("sqlforge_track_leftW", setLeftW);
    num("sqlforge_track_rightW", setRightW);
    num("sqlforge_track_outputH", setOutputH);
    setShowLeft(localStorage.getItem("sqlforge_track_showLeft") !== "0");
    setShowRight(localStorage.getItem("sqlforge_track_showRight") !== "0");
  }, []);

  function togglePanel(which: "left" | "right") {
    if (which === "left") {
      setShowLeft((s) => {
        localStorage.setItem("sqlforge_track_showLeft", s ? "0" : "1");
        return !s;
      });
    } else {
      setShowRight((s) => {
        localStorage.setItem("sqlforge_track_showRight", s ? "0" : "1");
        return !s;
      });
    }
  }

  async function loadTable(name: string) {
    setDataTable(name);
    setDataBusy(true);
    try {
      setDataResult(await api.trackRun(id, `SELECT * FROM ${name} LIMIT 200`));
      setServerUp(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDataBusy(false);
    }
  }
  useEffect(() => {
    localStorage.setItem("sqlforge_track_leftW", String(leftW));
  }, [leftW]);
  useEffect(() => {
    localStorage.setItem("sqlforge_track_rightW", String(rightW));
  }, [rightW]);
  useEffect(() => {
    localStorage.setItem("sqlforge_track_outputH", String(outputH));
  }, [outputH]);

  useEffect(() => {
    api
      .track(id)
      .then((d) => {
        setTrack(d.track);
        setSchema(d.schema);
        setServerUp(d.track.status === "active");
        generate(); // spin up + first question
      })
      .catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function generate() {
    setBusy("question");
    setErr(null);
    setEvalResult(null);
    setResult(null);
    setSql("-- write your query here\n");
    try {
      const q = await api.trackQuestion(id);
      setQuestion(q);
      setServerUp(true);
      setLeftTab("question");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy("run");
    setErr(null);
    try {
      setResult(await api.trackRun(id, sql));
      setServerUp(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!question) return;
    setBusy("submit");
    setErr(null);
    try {
      const ev = await api.trackSubmit(id, question.id, sql);
      setEvalResult(ev);
      setRightTab("review"); // surface the score/feedback after submitting
      if (ev.result) setResult(ev.result);
      if (ev.level) setTrack((t: any) => ({ ...t, level: ev.level }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function stopServer() {
    setBusy("stop");
    try {
      await api.stopTrack(id);
      setServerUp(false);
    } finally {
      setBusy(null);
    }
  }

  if (!track) {
    return (
      <Shell>
        <div className="p-8 text-sm text-sub">
          {err ? <span className="text-bad">{err}</span> : "Loading track…"}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex h-screen flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-line bg-white px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/tracks" className="text-sm text-sub hover:text-ink">
              ← Tracks
            </Link>
            <span className="text-line">/</span>
            <h1 className="truncate text-sm font-semibold">{track.name}</h1>
            <span className="tag shrink-0">custom</span>
            <Difficulty level={track.level} />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-1 rounded-md border border-line p-0.5">
              <PanelToggle
                side="left"
                active={showLeft}
                onClick={() => togglePanel("left")}
                title="Toggle question / schema / data panel"
              />
              <PanelToggle
                side="right"
                active={showRight}
                onClick={() => togglePanel("right")}
                title="Toggle AI reviewer panel"
              />
            </div>
            <span
              className={`flex items-center gap-1.5 text-xs ${
                serverUp ? "text-ok" : "text-sub"
              }`}
              title="The dataset's database is only running while you work on it"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  serverUp ? "bg-ok" : "bg-line"
                }`}
              />
              {serverUp ? "dataset live" : "dataset idle"}
            </span>
            {serverUp && (
              <button
                className="btn"
                onClick={stopServer}
                disabled={busy === "stop"}
                title="Spin down the dataset database to free resources"
              >
                {busy === "stop" ? "Stopping…" : "Stop dataset"}
              </button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Left: Question / Schema / Data */}
          {showLeft && (
            <aside
              style={{ width: leftW }}
              className="flex shrink-0 flex-col border-r border-line bg-white"
            >
              <div className="flex items-center gap-1 border-b border-line px-3">
                {(["question", "schema", "data"] as LeftTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setLeftTab(t)}
                    className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                      leftTab === t
                        ? "border-accent text-ink"
                        : "border-transparent text-sub hover:text-ink"
                    }`}
                  >
                    {t === "schema" ? "Schema" : t === "data" ? "Data" : "Question"}
                  </button>
                ))}
              </div>

              {leftTab === "question" && (
                <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
                  {question ? (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <Difficulty level={question.level} />
                        <span className="tag">
                          {question.source === "ai" ? "AI-generated" : "generated"}
                        </span>
                      </div>
                      <div className="rounded-lg border border-line bg-canvas p-4 text-sm leading-relaxed">
                        <Markdownish text={question.prompt} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(question.skills || []).map((s: string) => (
                          <span key={s} className="tag">
                            {s}
                          </span>
                        ))}
                      </div>
                      <button
                        className="btn mt-4"
                        onClick={generate}
                        disabled={!!busy}
                      >
                        {busy === "question" ? "Generating…" : "Skip / new question"}
                      </button>
                      <p className="mt-3 text-xs text-sub">
                        Difficulty adapts: solve it and the next question gets
                        harder; miss it and it eases off.
                      </p>
                    </>
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center text-center">
                      <p className="text-sm text-sub">
                        {busy === "question"
                          ? "Spinning up your dataset and writing a question…"
                          : "No question yet."}
                      </p>
                      <button
                        className="btn btn-primary mt-3"
                        onClick={generate}
                        disabled={!!busy}
                      >
                        Generate question
                      </button>
                    </div>
                  )}
                </div>
              )}

              {leftTab === "schema" && (
                <div className="min-h-0 flex-1">
                  <SchemaCanvas
                    tables={schema.tables}
                    relations={schema.relations}
                    storageKey={`sqlforge_schema_pos_${id}`}
                  />
                </div>
              )}

              {leftTab === "data" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex flex-wrap gap-1.5 border-b border-line p-3">
                    {schema.tables.map((t: any) => (
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
          {showLeft && (
            <Splitter
              axis="x"
              onDelta={(d) => setLeftW((w) => Math.max(260, Math.min(640, w + d)))}
            />
          )}

          {/* Center: editor + results */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-line bg-canvas px-3 py-1.5">
              <div className="flex items-center gap-2">
                {!showLeft && (
                  <button
                    onClick={() => togglePanel("left")}
                    title="Show question / schema / data"
                    className="flex h-6 w-6 items-center justify-center rounded text-sub hover:bg-white hover:text-ink"
                  >
                    <PanelGlyph side="left" active={false} />
                  </button>
                )}
                <span className="text-xs font-medium uppercase tracking-wide text-sub">
                SQL Editor
              </span>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn !py-1" onClick={run} disabled={!!busy}>
                  {busy === "run" ? "Running…" : "▶ Run"}
                </button>
                <button
                  className="btn btn-primary !py-1"
                  onClick={submit}
                  disabled={!!busy || !question}
                >
                  {busy === "submit" ? "Evaluating…" : "Submit answer"}
                </button>
                {!showRight && (
                  <button
                    onClick={() => togglePanel("right")}
                    title="Show AI reviewer"
                    className="flex h-6 w-6 items-center justify-center rounded text-sub hover:bg-white hover:text-ink"
                  >
                    <PanelGlyph side="right" active={false} />
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 border-b border-line">
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs"
                value={sql}
                onChange={(v) => setSql(v ?? "")}
                options={{
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 12 },
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  renderLineHighlight: "none",
                  overviewRulerLanes: 0,
                }}
              />
            </div>
            <Splitter
              axis="y"
              onDelta={(d) =>
                setOutputH((h) => Math.max(120, Math.min(640, h - d)))
              }
            />
            <div
              style={{ height: outputH }}
              className="flex min-h-0 shrink-0 flex-col bg-white"
            >
              <div className="flex items-center border-b border-line px-3">
                <span className="border-b-2 border-accent px-3 py-2 text-xs font-medium text-ink">
                  Results
                </span>
                <div className="ml-auto py-2 pr-1 text-xs text-sub">
                  {busy === "run" || busy === "submit" ? (
                    <span className="text-accent">running…</span>
                  ) : (
                    result?.ok && (
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
                {busy === "run" || busy === "submit" ? (
                  <RunningState
                    label={busy === "submit" ? "Evaluating…" : "Running query…"}
                  />
                ) : (
                  <ResultsTable result={result} />
                )}
              </div>
            </div>
          </section>
          {showRight && (
            <Splitter
              axis="x"
              onDelta={(d) => setRightW((w) => Math.max(280, Math.min(620, w - d)))}
            />
          )}

          {/* Right: AI mentor (chat) + reviewer */}
          {showRight && (
            <aside
              style={{ width: rightW }}
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
                    Chat to learn · reviews your answers
                  </div>
                </div>
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
                    {t === "review" && evalResult && (
                      <span
                        className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                          evalResult.passed ? "bg-ok" : "bg-warn"
                        }`}
                      />
                    )}
                  </button>
                ))}
              </div>
              {/* Both stay mounted so the conversation state survives tab switches */}
              <div className="min-h-0 flex-1">
                <div className={rightTab === "chat" ? "h-full" : "hidden"}>
                  <TrackMentorChat trackId={id} currentSql={sql} />
                </div>
                <div
                  className={
                    rightTab === "review" ? "h-full overflow-auto p-4" : "hidden"
                  }
                >
                  <FeedbackPanel
                    evalResult={evalResult}
                    busy={busy === "submit"}
                  />
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Markdownish({ text }: { text: string }) {
  // render **bold** and `code` lightly
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`"))
          return (
            <code key={i} className="rounded bg-white px-1 font-mono text-[12px]">
              {p.slice(1, -1)}
            </code>
          );
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

function ScoreRing({ score, passed }: { score: number; passed: boolean }) {
  const color = passed ? "#16a34a" : score >= 40 ? "#d97706" : "#dc2626";
  return (
    <div
      className="relative flex h-16 w-16 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(${color} ${score * 3.6}deg, #e7e8ec 0deg)`,
      }}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-sm font-semibold tabular-nums">
        {score}
      </div>
    </div>
  );
}

function FeedbackPanel({
  evalResult,
  busy,
}: {
  evalResult: any;
  busy: boolean;
}) {
  if (busy)
    return <p className="text-sm text-sub">Running your query and reviewing…</p>;
  if (!evalResult)
    return (
      <p className="text-sm text-sub">
        Read the question, write your query, then{" "}
        <strong>Submit answer</strong>. I'll check it against the dataset and
        review correctness, readability and optimization.
      </p>
    );
  if (evalResult.ok === false) {
    return (
      <div>
        <p className="text-sm font-medium text-bad">
          {evalResult.feedback?.summary}
        </p>
        <pre className="mt-2 whitespace-pre-wrap rounded bg-canvas p-2 font-mono text-xs text-bad">
          {evalResult.error}
        </pre>
      </div>
    );
  }
  const fb = evalResult.feedback || {};
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScoreRing score={evalResult.score} passed={evalResult.passed} />
        <div>
          <div
            className={`text-sm font-semibold ${
              evalResult.passed ? "text-ok" : "text-warn"
            }`}
          >
            {evalResult.passed ? "Correct ✓" : "Not quite"}
          </div>
          <div className="text-xs text-sub">
            expected {evalResult.expected_rows} rows · you returned{" "}
            {evalResult.got_rows}
          </div>
        </div>
      </div>

      {fb.summary && <p className="text-sm">{fb.summary}</p>}

      {fb.optimization && (
        <Block title="Optimization & quality">{fb.optimization}</Block>
      )}
      {fb.next && <Block title="Next">{fb.next}</Block>}

      {!evalResult.passed && evalResult.expected_columns?.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">
            Expected output shape
          </h4>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-xs">
              <thead className="bg-canvas">
                <tr>
                  {evalResult.expected_columns.map((c: string) => (
                    <th key={c} className="px-2 py-1 text-left font-medium text-sub">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evalResult.expected_preview.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-line">
                    {evalResult.expected_columns.map((c: string) => (
                      <td key={c} className="px-2 py-1 font-mono">
                        {String(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-sub">
            A small preview of the correct result — match its columns and rows.
          </p>
        </div>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-sub">
        {title}
      </h4>
      <p className="text-sm text-ink">{children}</p>
    </div>
  );
}
