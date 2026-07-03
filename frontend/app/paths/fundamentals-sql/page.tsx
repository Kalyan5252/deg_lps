'use client';

import Editor from '@monaco-editor/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import ResultsTable from '@/components/ResultsTable';

type PracticeResult = { columns: string[]; rows: any[]; command?: string };
type CourseSlide =
  | {
      kind: 'story';
      eyebrow: string;
      title: string;
      body: string;
      accent: string;
    }
  | {
      kind: 'practice';
      title: string;
      clause: string;
      story: string;
      why: string;
      example: string;
      prompt: string;
      starter: string;
      check: (sql: string) => boolean;
      hint: string;
      result: PracticeResult;
      tables?: Array<'customers' | 'orders' | 'products'>;
    };

const customers = [
  { id: 1, name: 'Asha', city: 'Chennai', plan: 'Pro', total_spent: 4200 },
  { id: 2, name: 'Ben', city: 'Mumbai', plan: 'Free', total_spent: 650 },
  { id: 3, name: 'Cara', city: 'Chennai', plan: 'Team', total_spent: 9800 },
  { id: 4, name: 'Dev', city: 'Bengaluru', plan: 'Pro', total_spent: 3100 },
  { id: 5, name: 'Isha', city: 'Delhi', plan: 'Free', total_spent: 900 },
  { id: 6, name: 'Noah', city: 'Mumbai', plan: 'Team', total_spent: 7200 },
];

const orders = [
  { id: 101, customer_id: 1, product_id: 201, item: 'Keyboard', amount: 1200 },
  { id: 102, customer_id: 3, product_id: 202, item: 'Monitor', amount: 8200 },
  { id: 103, customer_id: 4, product_id: 203, item: 'Mouse', amount: 900 },
  { id: 104, customer_id: 6, product_id: 204, item: 'Desk', amount: 5400 },
  { id: 105, customer_id: 1, product_id: 205, item: 'Cable', amount: 300 },
];

const products = [
  { id: 201, sku: 'KB-01', category: 'Accessories' },
  { id: 202, sku: 'MN-27', category: 'Displays' },
  { id: 203, sku: 'MS-10', category: 'Accessories' },
  { id: 204, sku: 'DK-55', category: 'Furniture' },
  { id: 205, sku: 'CB-02', category: 'Accessories' },
];

const editorPrompt = '-- start writing query here\n';
const clean = (sql: string) =>
  sql
    .toLowerCase()
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/;$/, '')
    .trim();
const has = (sql: string, pattern: RegExp) => pattern.test(clean(sql));

const slides: CourseSlide[] = [
  {
    kind: 'story',
    eyebrow: 'Welcome',
    title: 'Fundamentals of SQL',
    body: 'You are stepping into a tiny product company. Customers are signing up, orders are coming in, and the team keeps asking questions the dashboard cannot answer yet.',
    accent: 'Start by learning how to ask the database clear questions.',
  },
  {
    kind: 'story',
    eyebrow: 'Screen 1',
    title: 'What is SQL?',
    body: 'SQL is a language for working with structured data. You use it to define tables, change data, query rows, summarize results, and clean up database objects when they are no longer needed.',
    accent: 'SQL is both a question language and a database construction kit.',
  },
  {
    kind: 'story',
    eyebrow: 'Screen 2',
    title: 'Data Definition, Data Manipulation, and queries',
    body: 'Data Definition Language (DDL) creates or changes structure: CREATE, ALTER, DROP. Data Manipulation Language (DML) changes rows: INSERT, UPDATE, DELETE. Queries read and shape data: SELECT, WHERE, JOIN, GROUP BY, ORDER BY.',
    accent: 'First design the table, then change the rows, then ask questions.',
  },
  {
    kind: 'story',
    eyebrow: 'Screen 3',
    title: 'Clauses are the building blocks',
    body: 'A SQL statement is built from clauses. Each clause has a job: choose columns, choose tables, filter rows, combine tables, summarize groups, sort results, and limit output.',
    accent:
      'We will learn the clauses in the order a real analyst reaches for them.',
  },
  {
    kind: 'practice',
    title: 'Create Table',
    clause: 'Data Definition Language (DDL): CREATE TABLE',
    story:
      'Before the team can store products, the database needs a table shape: column names and data types.',
    why: 'CREATE TABLE defines structure. It says what a row looks like before any data exists.',
    example: 'CREATE TABLE products (id INT, sku TEXT, category TEXT);',
    prompt: 'Create a products table with id, sku, and category.',
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^create\s+table\s+products\s*\(\s*id\s+int\s*,\s*sku\s+text\s*,\s*category\s+text\s*\)$/,
      ),
    hint: 'Use CREATE TABLE products (id INT, sku TEXT, category TEXT).',
    result: { columns: [], rows: [], command: 'CREATE TABLE products' },
    tables: ['products'],
  },
  {
    kind: 'practice',
    title: 'Alter Table',
    clause: 'Data Definition Language (DDL): ALTER TABLE',
    story:
      'The table exists, but product asks to track whether an item is active. The structure needs one more column.',
    why: 'ALTER TABLE changes an existing table without recreating it from scratch.',
    example: 'ALTER TABLE products ADD COLUMN active BOOLEAN;',
    prompt: 'Add an active column to products.',
    starter: editorPrompt,
    check: (sql) =>
      has(sql, /^alter\s+table\s+products\s+add\s+column\s+active\s+boolean$/),
    hint: 'Use ALTER TABLE products ADD COLUMN active BOOLEAN.',
    result: { columns: [], rows: [], command: 'ALTER TABLE products' },
    tables: ['products'],
  },
  {
    kind: 'practice',
    title: 'Insert Rows',
    clause: 'Data Manipulation Language (DML): INSERT',
    story:
      'A table with no rows is only a promise. INSERT turns structure into data.',
    why: 'INSERT adds new rows to a table. It is how applications and ETL jobs load data.',
    example:
      "INSERT INTO products (id, sku, category) VALUES (206, 'HD-01', 'Audio');",
    prompt: 'Insert one Audio product with id 206 and sku HD-01.',
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^insert\s+into\s+products\s*\(\s*id\s*,\s*sku\s*,\s*category\s*\)\s+values\s*\(\s*206\s*,\s*['"]hd-01['"]\s*,\s*['"]audio['"]\s*\)$/,
      ),
    hint: "Use INSERT INTO products (id, sku, category) VALUES (206, 'HD-01', 'Audio').",
    result: { columns: [], rows: [], command: 'INSERT 1' },
    tables: ['products'],
  },
  {
    kind: 'practice',
    title: 'Update Rows',
    clause: 'Data Manipulation Language (DML): UPDATE',
    story:
      'Data changes. A product can move categories, a customer can change plans, and mistakes get corrected.',
    why: 'UPDATE modifies existing rows. WHERE is important because it controls which rows change.',
    example: "UPDATE customers SET plan = 'Team' WHERE name = 'Ben';",
    prompt: "Change Ben's plan to Team.",
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^update\s+customers\s+set\s+plan\s*=\s*['"]team['"]\s+where\s+name\s*=\s*['"]ben['"]$/,
      ),
    hint: "Use UPDATE customers SET plan = 'Team' WHERE name = 'Ben'.",
    result: { columns: [], rows: [], command: 'UPDATE 1' },
    tables: ['customers'],
  },
  {
    kind: 'practice',
    title: 'Select Clause',
    clause: 'QUERY: SELECT + FROM',
    story:
      'The team wants a simple contact list. No filters yet, no sorting, just the columns that matter.',
    why: 'SELECT chooses the columns you want to see. FROM tells SQL which table those columns come from.',
    example: 'SELECT name, city FROM customers;',
    prompt: "Show every customer's name and city.",
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+name\s*,\s*city\s+from\s+customers$/),
    hint: 'Use SELECT name, city FROM customers.',
    result: {
      columns: ['name', 'city'],
      rows: customers.map(({ name, city }) => ({ name, city })),
    },
    tables: ['customers'],
  },
  {
    kind: 'practice',
    title: 'Where Clause',
    clause: 'QUERY: WHERE',
    story:
      'Support is handling a Chennai campaign. They only need customers from that city.',
    why: 'WHERE keeps only rows that match a condition. It turns a large table into a focused answer.',
    example: "SELECT name, city FROM customers WHERE city = 'Chennai';",
    prompt: 'Find customers who are in Chennai.',
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^select\s+name\s*,\s*city\s+from\s+customers\s+where\s+city\s*=\s*['"]chennai['"]$/,
      ),
    hint: "Add WHERE city = 'Chennai' after FROM customers.",
    result: {
      columns: ['name', 'city'],
      rows: customers
        .filter((c) => c.city === 'Chennai')
        .map(({ name, city }) => ({ name, city })),
    },
    tables: ['customers'],
  },
  {
    kind: 'practice',
    title: 'Inner Join',
    clause: 'QUERY: INNER JOIN',
    story:
      'The next question crosses tables: which customer bought which item?',
    why: 'INNER JOIN returns rows that match on both sides. It is the everyday join for related records.',
    example:
      'SELECT customers.name, orders.item FROM customers JOIN orders ON customers.id = orders.customer_id;',
    prompt: "Show each order item with the customer's name.",
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^select\s+customers\.name\s*,\s*orders\.item\s+from\s+customers\s+join\s+orders\s+on\s+customers\.id\s*=\s*orders\.customer_id$/,
      ),
    hint: 'Join orders ON customers.id = orders.customer_id.',
    result: {
      columns: ['name', 'item'],
      rows: orders.map((o) => ({
        name: customers.find((c) => c.id === o.customer_id)?.name,
        item: o.item,
      })),
    },
    tables: ['customers', 'orders'],
  },
  {
    kind: 'practice',
    title: 'Multiple Joins',
    clause: 'QUERY: JOIN + JOIN',
    story:
      'One join links customers to orders. A second join adds product details, so a raw order becomes business context.',
    why: 'Multiple joins let you walk across a schema: customer -> order -> product.',
    example:
      'SELECT customers.name, orders.item, products.category FROM customers JOIN orders ON customers.id = orders.customer_id JOIN products ON orders.product_id = products.id;',
    prompt: 'Show customer name, order item, and product category.',
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^select\s+customers\.name\s*,\s*orders\.item\s*,\s*products\.category\s+from\s+customers\s+join\s+orders\s+on\s+customers\.id\s*=\s*orders\.customer_id\s+join\s+products\s+on\s+orders\.product_id\s*=\s*products\.id$/,
      ),
    hint: 'Join orders first, then join products ON orders.product_id = products.id.',
    result: {
      columns: ['name', 'item', 'category'],
      rows: orders.map((o) => ({
        name: customers.find((c) => c.id === o.customer_id)?.name,
        item: o.item,
        category: products.find((p) => p.id === o.product_id)?.category,
      })),
    },
    tables: ['customers', 'orders', 'products'],
  },
  {
    kind: 'practice',
    title: 'Group By',
    clause: 'QUERY: GROUP BY + COUNT',
    story:
      'Now product wants a city-level picture instead of individual customers.',
    why: 'GROUP BY collapses rows into buckets. COUNT(*) answers how many rows are inside each bucket.',
    example: 'SELECT city, COUNT(*) FROM customers GROUP BY city;',
    prompt: 'Count how many customers are in each city.',
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^select\s+city\s*,\s*count\(\*\)\s+from\s+customers\s+group\s+by\s+city$/,
      ),
    hint: 'Select city and COUNT(*), then GROUP BY city.',
    result: {
      columns: ['city', 'count'],
      rows: Object.entries(
        customers.reduce<Record<string, number>>((acc, c) => {
          acc[c.city] = (acc[c.city] || 0) + 1;
          return acc;
        }, {}),
      ).map(([city, count]) => ({ city, count })),
    },
    tables: ['customers'],
  },
  {
    kind: 'practice',
    title: 'Order By and Limit',
    clause: 'QUERY: ORDER BY + LIMIT',
    story: 'Finance wants the top customers, not a long unsorted list.',
    why: 'ORDER BY sorts rows. LIMIT keeps only the first few after sorting.',
    example:
      'SELECT name, total_spent FROM customers ORDER BY total_spent DESC LIMIT 3;',
    prompt: 'Show only the top 3 customers by spending.',
    starter: editorPrompt,
    check: (sql) =>
      has(
        sql,
        /^select\s+name\s*,\s*total_spent\s+from\s+customers\s+order\s+by\s+total_spent\s+desc\s+limit\s+3$/,
      ),
    hint: 'Use ORDER BY total_spent DESC, then LIMIT 3.',
    result: {
      columns: ['name', 'total_spent'],
      rows: [...customers]
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, 3)
        .map(({ name, total_spent }) => ({ name, total_spent })),
    },
    tables: ['customers'],
  },
  {
    kind: 'practice',
    title: 'Delete Rows',
    clause: 'Data Manipulation Language (DML): DELETE',
    story:
      'Sometimes bad rows must be removed, but only after a careful WHERE clause.',
    why: 'DELETE removes rows. Without WHERE, it removes every row in the table.',
    example: "DELETE FROM customers WHERE plan = 'Free';",
    prompt: 'Delete Free-plan customers.',
    starter: editorPrompt,
    check: (sql) =>
      has(sql, /^delete\s+from\s+customers\s+where\s+plan\s*=\s*['"]free['"]$/),
    hint: "Use DELETE FROM customers WHERE plan = 'Free'.",
    result: { columns: [], rows: [], command: 'DELETE 2' },
    tables: ['customers'],
  },
  {
    kind: 'practice',
    title: 'Drop Table',
    clause: 'Data Definition Language (DDL): DROP TABLE',
    story:
      'When a temporary table is no longer useful, remove the table object itself.',
    why: 'DROP deletes the database object. DELETE removes rows; DROP removes the table structure too.',
    example: 'DROP TABLE products;',
    prompt: 'Drop the products table.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^drop\s+table\s+products$/),
    hint: 'Use DROP TABLE products.',
    result: { columns: [], rows: [], command: 'DROP TABLE products' },
    tables: ['products'],
  },
];

function datasetResult(table: 'customers' | 'orders' | 'products') {
  const rows =
    table === 'customers' ? customers : table === 'orders' ? orders : products;
  return {
    ok: true,
    columns: Object.keys(rows[0]),
    rows,
    row_count: rows.length,
    truncated: false,
  };
}

function slideTitle(slide: CourseSlide) {
  return slide.title;
}

export default function FundamentalsSqlPage() {
  const [slide, setSlide] = useState(0);
  const [sql, setSql] = useState(editorPrompt);
  const [status, setStatus] = useState<'idle' | 'pass' | 'fail'>('idle');
  const current = slides[slide];
  const totalSlides = slides.length;
  const progress = Math.round(((slide + 1) / totalSlides) * 100);
  const result = useMemo(
    () =>
      current.kind === 'practice' && status === 'pass'
        ? {
            ok: true,
            ...current.result,
            row_count: current.result.rows.length,
            truncated: false,
          }
        : null,
    [current, status],
  );

  function go(next: number) {
    const bounded = Math.max(0, Math.min(totalSlides - 1, next));
    setSlide(bounded);
    setSql(editorPrompt);
    setStatus('idle');
  }

  function run() {
    if (current.kind === 'practice') {
      setStatus(current.check(sql) ? 'pass' : 'fail');
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#0b0d11] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_88%,rgba(57,169,246,0.28),transparent_44%),linear-gradient(135deg,#090a0d_0%,#101721_56%,#08111a_100%)]" />
      <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:48px_48px]" />

      <div className="relative flex min-h-screen flex-col">
        <div className="course-rise flex items-start justify-between px-8 py-5">
          <Link
            href="/paths"
            className="text-sm text-white/60 hover:text-white"
          >
            Exit course
          </Link>
          <div className="flex items-start gap-4">
            <SlideNavigator current={slide} slides={slides} onJump={go} />
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
        </div>

        {current.kind === 'story' ? (
          <StorySlide
            slide={current}
            canBack={slide > 0}
            onBack={() => go(slide - 1)}
            onNext={() => go(slide + 1)}
          />
        ) : (
          <PracticeSlide
            lesson={current}
            slideNumber={slide + 1}
            sql={sql}
            status={status}
            result={result}
            onSql={setSql}
            onRun={run}
            onReset={() => {
              setSql(editorPrompt);
              setStatus('idle');
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

function SlideNavigator({
  current,
  slides,
  onJump,
}: {
  current: number;
  slides: CourseSlide[];
  onJump: (index: number) => void;
}) {
  return (
    <div className="group relative">
      <button className="min-w-56 rounded-md border border-white/10 bg-white/10 px-3 py-2 text-left backdrop-blur transition-colors hover:bg-white/15">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
          Current screen
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-white">
          {slideTitle(slides[current])}
        </div>
      </button>
      <div className="invisible absolute right-0 top-full z-50 mt-3 max-h-[62vh] w-72 translate-y-2 overflow-auto rounded-lg border border-white/25 bg-[#050912] p-2 opacity-0 shadow-[0_28px_90px_rgba(0,0,0,0.82)] ring-1 ring-black transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
        {slides.map((s, i) => (
          <button
            key={`${s.kind}-${s.title}-${i}`}
            onClick={() => onJump(i)}
            className={`block w-full rounded-md px-3 py-2 text-left transition-colors ${
              i === current
                ? 'bg-white text-ink'
                : 'text-white/70 hover:bg-white/10'
            }`}
          >
            <div className="text-[10px] uppercase tracking-[0.2em] opacity-60">
              Screen {i + 1}
            </div>
            <div className="truncate text-sm font-medium">{slideTitle(s)}</div>
          </button>
        ))}
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
  slide: Extract<CourseSlide, { kind: 'story' }>;
  canBack: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-8 pb-16">
      <section className="mx-auto max-w-5xl text-center">
        <div className="course-rise text-sm font-semibold uppercase tracking-[0.32em] text-blue-200/80">
          {slide.eyebrow}
        </div>
        <h1 className="course-rise course-rise-delay-1 mt-6 text-5xl font-semibold leading-tight tracking-normal md:text-7xl">
          {slide.title}
        </h1>
        <p className="course-rise course-rise-delay-2 mx-auto mt-8 max-w-4xl text-xl leading-9 text-white/72">
          {slide.body}
        </p>
        <p className="course-rise course-rise-delay-3 mt-6 font-serif text-2xl italic text-white">
          {slide.accent}
        </p>
        <div className="course-rise course-rise-delay-4 mt-12 flex justify-center gap-3">
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
  slideNumber,
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
  lesson: Extract<CourseSlide, { kind: 'practice' }>;
  slideNumber: number;
  sql: string;
  status: 'idle' | 'pass' | 'fail';
  result: any;
  onSql: (sql: string) => void;
  onRun: () => void;
  onReset: () => void;
  onBack: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const shownTables = lesson.tables || ['customers'];

  return (
    <main className="flex min-h-0 flex-1 flex-col px-8 pb-8">
      <section className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(340px,0.78fr)_minmax(0,1.22fr)]">
        <div className="course-rise flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur">
          <div className="course-rise course-rise-delay-1 text-sm font-semibold uppercase tracking-[0.24em] text-blue-200/80">
            Screen {slideNumber}
          </div>
          <h2 className="course-rise course-rise-delay-2 mt-5 text-4xl font-semibold tracking-normal">
            {lesson.title}
          </h2>
          <div className="course-rise course-rise-delay-3 mt-3 font-mono text-sm text-blue-100">
            {lesson.clause}
          </div>
          <p className="course-rise course-rise-delay-4 mt-6 text-base leading-7 text-white/72">
            {lesson.story}
          </p>
          <p className="course-rise course-rise-delay-5 mt-4 text-sm leading-6 text-white/58">
            {lesson.why}
          </p>
          <div className="course-rise course-rise-delay-6 mt-5 rounded-md border border-white/10 bg-black/35 p-4 font-mono text-sm text-emerald-100">
            {lesson.example}
          </div>

          <div className="course-rise course-rise-delay-7 mt-6 min-h-0 flex-1 overflow-auto">
            <div className="mb-2 text-sm font-semibold text-white/85">
              Dataset
            </div>
            <div className="space-y-3">
              {shownTables.map((table) => (
                <div
                  key={table}
                  className="overflow-hidden rounded-md border border-white/10 bg-white"
                >
                  <div className="border-b border-line bg-canvas px-3 py-2 font-mono text-xs font-semibold text-ink">
                    {table}
                  </div>
                  <div className="h-32 text-ink">
                    <ResultsTable result={datasetResult(table)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="course-rise course-rise-delay-2 flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl">
          <div className="course-rise course-rise-delay-3 border-b border-line p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-sub">
              Your turn
            </div>
            <p className="mt-1 text-sm text-ink">{lesson.prompt}</p>
          </div>
          <div className="course-rise course-rise-delay-4 min-h-0 flex-1">
            <Editor
              height="100%"
              defaultLanguage="sql"
              theme="vs"
              value={sql}
              onChange={(value) => onSql(value || '')}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16 },
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                renderLineHighlight: 'none',
              }}
            />
          </div>
          <div className="course-rise course-rise-delay-5 flex h-56 min-h-0 flex-col border-t border-line">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-sub">
                Result
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {status === 'pass' && (
                  <span className="text-xs font-medium text-ok">Correct</span>
                )}
                {status === 'fail' && (
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
                  disabled={status !== 'pass' || isLast}
                  onClick={onNext}
                >
                  Next →
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 text-ink">
              {status === 'idle' ? (
                <div className="flex h-full items-center justify-center text-sm text-sub">
                  Run the query when you are ready.
                </div>
              ) : status === 'fail' ? (
                <div className="m-4 rounded-md border border-bad/30 bg-bad/5 p-3 text-sm text-bad">
                  The query is close. Use the statement pattern shown on this
                  slide.
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
