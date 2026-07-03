"use client";

import Editor from "@monaco-editor/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import ResultsTable from "@/components/ResultsTable";

type Lesson = {
  title: string;
  clause: string;
  story: string;
  why: string;
  example: string;
  prompt: string;
  starter: string;
  check: (sql: string) => boolean;
  hint: string;
  result: { columns: string[]; rows: any[] };
};

const customers = [
  { id: 1, name: "Asha", city: "Chennai", plan: "Pro", total_spent: 4200 },
  { id: 2, name: "Ben", city: "Mumbai", plan: "Free", total_spent: 650 },
  { id: 3, name: "Cara", city: "Chennai", plan: "Team", total_spent: 9800 },
  { id: 4, name: "Dev", city: "Bengaluru", plan: "Pro", total_spent: 3100 },
  { id: 5, name: "Isha", city: "Delhi", plan: "Free", total_spent: 900 },
  { id: 6, name: "Noah", city: "Mumbai", plan: "Team", total_spent: 7200 },
];

const orders = [
  { id: 101, customer_id: 1, item: "Keyboard", amount: 1200 },
  { id: 102, customer_id: 3, item: "Monitor", amount: 8200 },
  { id: 103, customer_id: 4, item: "Mouse", amount: 900 },
  { id: 104, customer_id: 6, item: "Desk", amount: 5400 },
  { id: 105, customer_id: 1, item: "Cable", amount: 300 },
];

const clean = (sql: string) =>
  sql
    .toLowerCase()
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/;$/, "")
    .trim();

const has = (sql: string, pattern: RegExp) => pattern.test(clean(sql));

const storySlides = [
  {
    eyebrow: "Welcome",
    title: "Fundamentals of SQL",
    body: "You are stepping into a tiny product company. Customers are signing up, orders are coming in, and the team keeps asking questions the dashboard cannot answer yet.",
    accent: "Start by learning how to ask the database clear questions.",
  },
  {
    eyebrow: "Screen 1",
    title: "What is SQL?",
    body: "SQL is a language for speaking to structured data. Tables hold rows. Columns describe each row. A query is the sentence you write to ask for exactly the data you need.",
    accent: "SQL turns raw tables into answers.",
  },
  {
    eyebrow: "Screen 2",
    title: "Why SQL matters in the real world",
    body: "A support lead asks which customers are in Chennai. A finance teammate asks who spends the most. A product manager asks how many customers use each plan. SQL is how data teams answer those questions without guessing.",
    accent: "Every clause narrows the question.",
  },
  {
    eyebrow: "Screen 3",
    title: "Clauses are the building blocks",
    body: "A SQL query is built from clauses. SELECT chooses columns. FROM chooses the table. WHERE filters rows. ORDER BY sorts. GROUP BY summarizes. JOIN combines tables.",
    accent: "Learn the clauses in order, then use them immediately.",
  },
];

const lessons: Lesson[] = [
  {
    title: "Select Clause",
    clause: "SELECT + FROM",
    story:
      "The team wants a simple contact list. No filters yet, no sorting, just the columns that matter.",
    why: "SELECT chooses the columns you want to see. FROM tells SQL which table those columns come from.",
    example: "SELECT name, city FROM customers;",
    prompt: "Show every customer's name and city.",
    starter: "SELECT name, city\nFROM customers;",
    check: (sql) =>
      has(sql, /^select\s+name\s*,\s*city\s+from\s+customers$/),
    hint: "Use SELECT name, city FROM customers.",
    result: {
      columns: ["name", "city"],
      rows: customers.map(({ name, city }) => ({ name, city })),
    },
  },
  {
    title: "Where Clause",
    clause: "WHERE",
    story:
      "Support is handling a Chennai campaign. They only need customers from that city.",
    why: "WHERE keeps only rows that match a condition. It turns a large table into a focused answer.",
    example: "SELECT name, city FROM customers WHERE city = 'Chennai';",
    prompt: "Find customers who are in Chennai.",
    starter: "SELECT name, city\nFROM customers\nWHERE city = 'Chennai';",
    check: (sql) =>
      has(sql, /^select\s+name\s*,\s*city\s+from\s+customers\s+where\s+city\s*=\s*['"]chennai['"]$/),
    hint: "Add WHERE city = 'Chennai' after FROM customers.",
    result: {
      columns: ["name", "city"],
      rows: customers
        .filter((c) => c.city === "Chennai")
        .map(({ name, city }) => ({ name, city })),
    },
  },
  {
    title: "Order By Clause",
    clause: "ORDER BY",
    story:
      "Finance wants to see the highest-value customers first before making outreach decisions.",
    why: "ORDER BY controls result order. DESC means largest-to-smallest; ASC means smallest-to-largest.",
    example: "SELECT name, total_spent FROM customers ORDER BY total_spent DESC;",
    prompt: "List customers from highest spender to lowest spender.",
    starter: "SELECT name, total_spent\nFROM customers\nORDER BY total_spent DESC;",
    check: (sql) =>
      has(sql, /^select\s+name\s*,\s*total_spent\s+from\s+customers\s+order\s+by\s+total_spent\s+desc$/),
    hint: "Sort with ORDER BY total_spent DESC.",
    result: {
      columns: ["name", "total_spent"],
      rows: [...customers]
        .sort((a, b) => b.total_spent - a.total_spent)
        .map(({ name, total_spent }) => ({ name, total_spent })),
    },
  },
  {
    title: "Limit Clause",
    clause: "LIMIT",
    story:
      "The list is useful, but the team only wants the top three customers for a quick morning review.",
    why: "LIMIT caps how many rows come back. It is useful for previews, leaderboards, and safe exploration.",
    example: "SELECT name, total_spent FROM customers ORDER BY total_spent DESC LIMIT 3;",
    prompt: "Show only the top 3 customers by spending.",
    starter: "SELECT name, total_spent\nFROM customers\nORDER BY total_spent DESC\nLIMIT 3;",
    check: (sql) =>
      has(sql, /^select\s+name\s*,\s*total_spent\s+from\s+customers\s+order\s+by\s+total_spent\s+desc\s+limit\s+3$/),
    hint: "Use ORDER BY total_spent DESC, then LIMIT 3.",
    result: {
      columns: ["name", "total_spent"],
      rows: [...customers]
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, 3)
        .map(({ name, total_spent }) => ({ name, total_spent })),
    },
  },
  {
    title: "Group By Clause",
    clause: "GROUP BY + COUNT",
    story:
      "Now product wants a city-level picture instead of individual customers.",
    why: "GROUP BY collapses rows into buckets. COUNT(*) answers how many rows are inside each bucket.",
    example: "SELECT city, COUNT(*) FROM customers GROUP BY city;",
    prompt: "Count how many customers are in each city.",
    starter: "SELECT city, COUNT(*)\nFROM customers\nGROUP BY city;",
    check: (sql) =>
      has(sql, /^select\s+city\s*,\s*count\(\*\)\s+from\s+customers\s+group\s+by\s+city$/),
    hint: "Select city and COUNT(*), then GROUP BY city.",
    result: {
      columns: ["city", "count"],
      rows: Object.entries(
        customers.reduce<Record<string, number>>((acc, c) => {
          acc[c.city] = (acc[c.city] || 0) + 1;
          return acc;
        }, {})
      ).map(([city, count]) => ({ city, count })),
    },
  },
  {
    title: "Join Clause",
    clause: "JOIN ... ON",
    story:
      "The final question crosses tables: which customer bought which item?",
    why: "JOIN combines related rows from two tables. ON explains how the rows match.",
    example:
      "SELECT customers.name, orders.item FROM customers JOIN orders ON customers.id = orders.customer_id;",
    prompt: "Show each order item with the customer's name.",
    starter:
      "SELECT customers.name, orders.item\nFROM customers\nJOIN orders ON customers.id = orders.customer_id;",
    check: (sql) =>
      has(sql, /^select\s+customers\.name\s*,\s*orders\.item\s+from\s+customers\s+join\s+orders\s+on\s+customers\.id\s*=\s*orders\.customer_id$/),
    hint: "Join orders ON customers.id = orders.customer_id.",
    result: {
      columns: ["name", "item"],
      rows: orders.map((o) => ({
        name: customers.find((c) => c.id === o.customer_id)?.name,
        item: o.item,
      })),
    },
  },
];

function datasetResult(table: "customers" | "orders") {
  const rows = table === "customers" ? customers : orders;
  return {
    ok: true,
    columns: Object.keys(rows[0]),
    rows,
    row_count: rows.length,
    truncated: false,
  };
}

export default function FundamentalsSqlPage() {
  const [slide, setSlide] = useState(0);
  const [sql, setSql] = useState(lessons[0].starter);
  const [status, setStatus] = useState<"idle" | "pass" | "fail">("idle");
  const lessonIndex = slide - storySlides.length;
  const lesson = lessons[Math.max(0, lessonIndex)];
  const isPractice = lessonIndex >= 0;
  const totalSlides = storySlides.length + lessons.length;
  const progress = Math.round(((slide + 1) / totalSlides) * 100);
  const result = useMemo(
    () =>
      status === "pass"
        ? {
            ok: true,
            ...lesson.result,
            row_count: lesson.result.rows.length,
            truncated: false,
          }
        : null,
    [lesson, status]
  );

  function go(next: number) {
    const bounded = Math.max(0, Math.min(totalSlides - 1, next));
    setSlide(bounded);
    const nextLessonIndex = bounded - storySlides.length;
    if (nextLessonIndex >= 0) setSql(lessons[nextLessonIndex].starter);
    setStatus("idle");
  }

  function run() {
    setStatus(lesson.check(sql) ? "pass" : "fail");
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#0b0d11] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(47,109,246,0.38),transparent_34%),radial-gradient(circle_at_76%_24%,rgba(150,58,210,0.28),transparent_30%),linear-gradient(135deg,#090a0d_0%,#101721_56%,#08111a_100%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative flex min-h-screen flex-col">
        <div className="flex items-center justify-between px-8 py-5">
          <Link href="/paths" className="text-sm text-white/60 hover:text-white">
            Exit course
          </Link>
          <div className="w-56">
            <div className="mb-1 flex justify-between text-xs text-white/50">
              <span>
                Screen {slide + 1}/{totalSlides}
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

        {!isPractice ? (
          <StorySlide
            slide={storySlides[slide]}
            canBack={slide > 0}
            onBack={() => go(slide - 1)}
            onNext={() => go(slide + 1)}
          />
        ) : (
          <PracticeSlide
            lesson={lesson}
            lessonIndex={lessonIndex}
            sql={sql}
            status={status}
            result={result}
            onSql={setSql}
            onRun={run}
            onReset={() => {
              setSql(lesson.starter);
              setStatus("idle");
            }}
            onBack={() => go(slide - 1)}
            onNext={() => go(slide + 1)}
            isLast={slide === totalSlides - 1}
          />
        )}
      </div>
    </div>
  );
}

function StorySlide({
  slide,
  canBack,
  onBack,
  onNext,
}: {
  slide: (typeof storySlides)[number];
  canBack: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-8 pb-16">
      <section className="mx-auto max-w-4xl text-center">
        <div className="text-sm font-semibold uppercase tracking-[0.32em] text-blue-200/80">
          {slide.eyebrow}
        </div>
        <h1 className="mt-6 text-5xl font-semibold leading-tight tracking-normal md:text-7xl">
          {slide.title}
        </h1>
        <p className="mx-auto mt-8 max-w-3xl text-xl leading-9 text-white/72">
          {slide.body}
        </p>
        <p className="mt-6 font-serif text-2xl italic text-white">
          {slide.accent}
        </p>
        <div className="mt-12 flex justify-center gap-3">
          <button className="btn" disabled={!canBack} onClick={onBack}>
            ← Back
          </button>
          <button className="btn btn-primary" onClick={onNext}>
            Next →
          </button>
        </div>
      </section>
    </main>
  );
}

function PracticeSlide({
  lesson,
  lessonIndex,
  sql,
  status,
  result,
  onSql,
  onRun,
  onReset,
  onBack,
  onNext,
  isLast,
}: {
  lesson: Lesson;
  lessonIndex: number;
  sql: string;
  status: "idle" | "pass" | "fail";
  result: any;
  onSql: (sql: string) => void;
  onRun: () => void;
  onReset: () => void;
  onBack: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-8">
      <section className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(340px,0.78fr)_minmax(0,1.22fr)]">
        <div className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur">
          <div className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-200/80">
            Screen {lessonIndex + storySlides.length + 1}
          </div>
          <h2 className="mt-5 text-4xl font-semibold tracking-normal">
            {lesson.title}
          </h2>
          <div className="mt-3 font-mono text-sm text-blue-100">
            {lesson.clause}
          </div>
          <p className="mt-6 text-base leading-7 text-white/72">{lesson.story}</p>
          <p className="mt-4 text-sm leading-6 text-white/58">{lesson.why}</p>
          <div className="mt-5 rounded-md border border-white/10 bg-black/35 p-4 font-mono text-sm text-emerald-100">
            {lesson.example}
          </div>

          <div className="mt-6 min-h-0 flex-1 overflow-auto">
            <div className="mb-2 text-sm font-semibold text-white/85">
              Dataset
            </div>
            <div className="overflow-hidden rounded-md border border-white/10 bg-white">
              <div className="border-b border-line bg-canvas px-3 py-2 font-mono text-xs font-semibold text-ink">
                customers
              </div>
              <div className="h-36 text-ink">
                <ResultsTable result={datasetResult("customers")} />
              </div>
            </div>
            {lesson.clause.includes("JOIN") && (
              <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-white">
                <div className="border-b border-line bg-canvas px-3 py-2 font-mono text-xs font-semibold text-ink">
                  orders
                </div>
                <div className="h-32 text-ink">
                  <ResultsTable result={datasetResult("orders")} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl">
          <div className="border-b border-line p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-sub">
              Your turn
            </div>
            <p className="mt-1 text-sm text-ink">{lesson.prompt}</p>
          </div>
          <div className="min-h-0 flex-1">
            <Editor
              height="100%"
              defaultLanguage="sql"
              theme="vs"
              value={sql}
              onChange={(value) => onSql(value || "")}
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
          <div className="flex h-56 min-h-0 flex-col border-t border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-sub">
                Result
              </div>
              <div className="flex items-center gap-2">
                {status === "pass" && (
                  <span className="text-xs font-medium text-ok">Correct</span>
                )}
                {status === "fail" && (
                  <span className="max-w-72 truncate text-xs font-medium text-bad">
                    {lesson.hint}
                  </span>
                )}
                <button className="btn !py-1" onClick={onReset}>
                  Reset
                </button>
                <button className="btn btn-primary !py-1" onClick={onRun}>
                  Run Check
                </button>
                <button className="btn !py-1" onClick={onBack}>
                  ← Back
                </button>
                <button
                  className="btn !py-1"
                  disabled={status !== "pass" || isLast}
                  onClick={onNext}
                >
                  Next →
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 text-ink">
              {status === "idle" ? (
                <div className="flex h-full items-center justify-center text-sm text-sub">
                  Run the query when you are ready.
                </div>
              ) : status === "fail" ? (
                <div className="m-4 rounded-md border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
                  The query is close. Use the clause pattern shown on this slide.
                </div>
              ) : (
                <ResultsTable result={result} />
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
