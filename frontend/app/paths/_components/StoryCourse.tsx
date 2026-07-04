"use client";

import Editor from "@monaco-editor/react";
import Link from "next/link";
import { useState } from "react";

export type StoryCourseSlide = {
  eyebrow: string;
  title: string;
  body: string;
  accent?: string;
  example?: string;
  practice?: {
    prompt: string;
    starter: string;
    expected: string | RegExp;
    hint: string;
    result?: string;
  };
};

export default function StoryCourse({
  title,
  slides,
}: {
  title: string;
  slides: StoryCourseSlide[];
}) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState(slides[0]?.practice?.starter || "-- write SQL here\n");
  const [status, setStatus] = useState<"idle" | "pass" | "fail">("idle");
  const current = slides[index];
  const progress = Math.round(((index + 1) / slides.length) * 100);

  function go(next: number) {
    const bounded = Math.max(0, Math.min(slides.length - 1, next));
    setIndex(bounded);
    setAnswer(slides[bounded]?.practice?.starter || "-- write SQL here\n");
    setStatus("idle");
  }

  function runCheck() {
    if (!current.practice) return;
    const normalized = answer
      .toLowerCase()
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .replace(/;$/, "")
      .trim();
    const expected = current.practice.expected;
    const ok =
      typeof expected === "string"
        ? normalized === expected.toLowerCase().replace(/\s+/g, " ").trim()
        : expected.test(normalized);
    setStatus(ok ? "pass" : "fail");
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#0b0d11] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(47,109,246,0.38),transparent_34%),radial-gradient(circle_at_76%_24%,rgba(150,58,210,0.28),transparent_30%),linear-gradient(135deg,#090a0d_0%,#101721_56%,#08111a_100%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative flex min-h-screen flex-col">
        <div className="course-rise relative z-[100] flex items-start justify-between px-8 py-5">
          <Link href="/paths" className="text-sm text-white/60 hover:text-white">
            Exit course
          </Link>
          <div className="flex items-start gap-4">
            <div className="group relative">
              <button className="min-w-56 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-left backdrop-blur transition-colors hover:bg-white/15">
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                  Current screen
                </div>
                <div className="mt-0.5 truncate text-sm font-medium text-white">
                  {current.title}
                </div>
              </button>
              <div className="invisible absolute right-0 top-full z-50 mt-3 max-h-[52vh] w-72 translate-y-2 overflow-auto rounded-lg border border-white/25 bg-[#050912] p-2 opacity-0 shadow-[0_28px_90px_rgba(0,0,0,0.82)] ring-1 ring-black transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                {slides.map((s, i) => (
                  <button
                    key={`${s.title}-${i}`}
                    onClick={() => go(i)}
                    className={`block w-full rounded-md px-3 py-2 text-left transition-colors ${
                      i === index
                        ? "bg-white text-ink"
                        : "text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.2em] opacity-60">
                      Screen {i + 1}
                    </div>
                    <div className="truncate text-sm font-medium">{s.title}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="w-56">
              <div className="mb-1 flex justify-between text-xs text-white/50">
                <span>
                  Screen {index + 1}/{slides.length}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-white transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <main className="flex flex-1 items-center justify-center px-8 pb-16">
          <section
            className={`mx-auto w-full ${
              current.practice
                ? "grid max-w-7xl grid-cols-1 gap-5 lg:grid-cols-[minmax(340px,0.85fr)_minmax(0,1.15fr)]"
                : "max-w-5xl text-center"
            }`}
          >
            <div className={current.practice ? "text-left" : ""}>
            <div className="course-rise text-sm font-semibold uppercase tracking-[0.32em] text-blue-200/80">
              {current.eyebrow}
            </div>
            <h1 className="course-rise course-rise-delay-1 mt-6 text-5xl font-semibold leading-tight tracking-normal md:text-7xl">
              {current.title}
            </h1>
            <p className="course-rise course-rise-delay-2 mx-auto mt-8 max-w-4xl text-xl leading-9 text-white/72">
              {current.body}
            </p>
            {current.example && (
              <div className="course-rise course-rise-delay-3 mx-auto mt-8 max-w-3xl rounded-lg border border-white/10 bg-black/35 p-5 text-left font-mono text-sm leading-7 text-emerald-100">
                {current.example}
              </div>
            )}
            {current.accent && (
              <p className="course-rise course-rise-delay-4 mt-6 font-serif text-2xl italic text-white">
                {current.accent}
              </p>
            )}
            <div className="course-rise course-rise-delay-5 mt-12 flex justify-center gap-3">
              <button className="btn" disabled={index === 0} onClick={() => go(index - 1)}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                disabled={index === slides.length - 1}
                onClick={() => go(index + 1)}
              >
                Next →
              </button>
            </div>
            </div>
            {current.practice && (
              <div className="course-rise course-rise-delay-2 flex min-h-[560px] flex-col overflow-hidden rounded-lg border border-white/10 bg-white text-ink shadow-2xl">
                <div className="border-b border-line p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-sub">
                    Your turn
                  </div>
                  <p className="mt-1 text-sm">{current.practice.prompt}</p>
                </div>
                <div className="min-h-0 flex-1">
                  <Editor
                    height="100%"
                    defaultLanguage="sql"
                    theme="vs"
                    value={answer}
                    onChange={(value) => setAnswer(value || "")}
                    options={{
                      fontSize: 14,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      padding: { top: 16 },
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      renderLineHighlight: "none",
                    }}
                  />
                </div>
                <div className="border-t border-line p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-sub">
                      Check
                    </div>
                    <div className="flex items-center gap-2">
                      {status === "pass" && (
                        <span className="text-xs font-medium text-ok">Correct</span>
                      )}
                      {status === "fail" && (
                        <span className="max-w-72 truncate text-xs font-medium text-bad">
                          {current.practice.hint}
                        </span>
                      )}
                      <button
                        className="btn !py-1"
                        onClick={() => {
                          setAnswer(current.practice?.starter || "-- write SQL here\n");
                          setStatus("idle");
                        }}
                      >
                        Reset
                      </button>
                      <button className="btn btn-primary !py-1" onClick={runCheck}>
                        Run Check
                      </button>
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-canvas p-3 font-mono text-sm text-sub">
                    {status === "pass"
                      ? current.practice.result || "Statement accepted."
                      : "Run the statement when you are ready."}
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
