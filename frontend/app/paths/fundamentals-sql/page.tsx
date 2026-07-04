'use client';

import Editor from '@monaco-editor/react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import ResultsTable from '@/components/ResultsTable';
import SchemaCanvas from '@/components/SchemaCanvas';

type PracticeResult = { columns: string[]; rows: any[]; command?: string };
type SchemaTable = {
  name: string;
  columns: { name: string; type: string; pk: boolean }[];
  row_count: number;
};
type Relation = {
  from_table: string;
  from_col: string;
  to_table: string;
  to_col: string;
};
type SchemaPatch = { tables?: SchemaTable[]; drop?: string[]; relations?: Relation[] };
type Lesson = {
  section: string;
  subsection: string;
  title: string;
  summary: string;
  bullets: string[];
  example: string;
  prompt?: string;
  starter?: string;
  check?: (sql: string) => boolean;
  hint?: string;
  result?: PracticeResult;
  tables?: Array<'customers' | 'orders' | 'products'>;
  schemaPatch?: SchemaPatch;
};

const editorPrompt = '-- write SQL here\n';
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

const baseSchema: SchemaTable[] = [
  {
    name: 'customers',
    row_count: customers.length,
    columns: [
      { name: 'id', type: 'int', pk: true },
      { name: 'name', type: 'text', pk: false },
      { name: 'city', type: 'text', pk: false },
      { name: 'plan', type: 'text', pk: false },
      { name: 'total_spent', type: 'int', pk: false },
    ],
  },
  {
    name: 'orders',
    row_count: orders.length,
    columns: [
      { name: 'id', type: 'int', pk: true },
      { name: 'customer_id', type: 'int', pk: false },
      { name: 'product_id', type: 'int', pk: false },
      { name: 'item', type: 'text', pk: false },
      { name: 'amount', type: 'int', pk: false },
    ],
  },
];
const baseRelations: Relation[] = [
  { from_table: 'orders', from_col: 'customer_id', to_table: 'customers', to_col: 'id' },
];

const clean = (sql: string) =>
  sql.toLowerCase().replace(/--.*$/gm, '').replace(/\s+/g, ' ').replace(/;$/, '').trim();
const has = (sql: string, pattern: RegExp) => pattern.test(clean(sql));
const result = (columns: string[], rows: any[], command?: string): PracticeResult => ({
  columns,
  rows,
  command,
});

const productTable: SchemaTable = {
  name: 'products',
  row_count: products.length,
  columns: [
    { name: 'id', type: 'int', pk: true },
    { name: 'sku', type: 'text', pk: false },
    { name: 'category', type: 'text', pk: false },
  ],
};
const lineItemTable: SchemaTable = {
  name: 'line_items',
  row_count: 0,
  columns: [
    { name: 'id', type: 'int', pk: true },
    { name: 'order_id', type: 'int', pk: false },
    { name: 'product_id', type: 'int', pk: false },
    { name: 'quantity', type: 'int', pk: false },
  ],
};

const lessons: Lesson[] = [
  {
    section: 'Orientation',
    subsection: 'SQL map',
    title: 'Fundamentals of SQL',
    summary: 'A complete beginner path organized by the same core ideas you see across W3Schools SQL: querying, filtering, joining, aggregating, changing data, and defining database objects.',
    bullets: ['Use the left rail to jump by section.', 'Interactive lessons include a SQL editor.', 'DDL lessons update the schema whiteboard when your statement passes.'],
    example: 'SELECT columns FROM table WHERE condition ORDER BY column;',
  },
  {
    section: 'SELECT',
    subsection: 'SELECT *',
    title: 'Read every column',
    summary: 'SELECT chooses what appears in the result. The star is useful for exploring a table, but production queries should usually name only needed columns.',
    bullets: ['SELECT * returns all columns.', 'FROM names the source table.', 'A semicolon ends a statement in many tools.'],
    example: 'SELECT * FROM customers;',
    prompt: 'Show every column from customers.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+\*\s+from\s+customers$/),
    hint: 'Use SELECT * FROM customers.',
    result: result(Object.keys(customers[0]), customers),
    tables: ['customers'],
  },
  {
    section: 'SELECT',
    subsection: 'Columns',
    title: 'Read specific columns',
    summary: 'Column lists make answers smaller, clearer, and easier to reuse.',
    bullets: ['Separate selected columns with commas.', 'Column order in SELECT controls display order.', 'Aliases can rename displayed columns later.'],
    example: 'SELECT name, city FROM customers;',
    prompt: 'Show customer name and city.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+name\s*,\s*city\s+from\s+customers$/),
    hint: 'Use SELECT name, city FROM customers.',
    result: result(['name', 'city'], customers.map(({ name, city }) => ({ name, city }))),
    tables: ['customers'],
  },
  {
    section: 'SELECT',
    subsection: 'DISTINCT',
    title: 'Remove duplicate values',
    summary: 'DISTINCT returns unique combinations of the selected columns.',
    bullets: ['DISTINCT applies to the whole selected row.', 'Use it for lists of categories, cities, or statuses.', 'It is not a substitute for fixing duplicated source data.'],
    example: 'SELECT DISTINCT city FROM customers;',
    prompt: 'List each customer city once.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+distinct\s+city\s+from\s+customers$/),
    hint: 'Use SELECT DISTINCT city FROM customers.',
    result: result(['city'], Array.from(new Set(customers.map((c) => c.city))).map((city) => ({ city }))),
    tables: ['customers'],
  },
  {
    section: 'Clauses',
    subsection: 'WHERE',
    title: 'Filter rows',
    summary: 'WHERE keeps rows that match a condition. It is the main clause for narrowing a table before the answer is returned.',
    bullets: ['Use comparison operators such as =, <>, >, <, >=, <=.', 'Text values are quoted.', 'WHERE runs before ordering and final display.'],
    example: "SELECT name, city FROM customers WHERE city = 'Chennai';",
    prompt: 'Find customers in Chennai.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+name\s*,\s*city\s+from\s+customers\s+where\s+city\s*=\s*['"]chennai['"]$/),
    hint: "Use WHERE city = 'Chennai'.",
    result: result(['name', 'city'], customers.filter((c) => c.city === 'Chennai').map(({ name, city }) => ({ name, city }))),
    tables: ['customers'],
  },
  {
    section: 'Clauses',
    subsection: 'AND OR NOT',
    title: 'Combine filters',
    summary: 'AND, OR, and NOT build precise conditions from smaller tests.',
    bullets: ['AND requires both conditions.', 'OR accepts either condition.', 'NOT reverses a condition; parentheses make mixed logic clear.'],
    example: "SELECT name FROM customers WHERE city = 'Mumbai' OR NOT plan = 'Free';",
    prompt: 'Find customers who are in Mumbai or are not on the Free plan.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+name\s+from\s+customers\s+where\s+city\s*=\s*['"]mumbai['"]\s+or\s+not\s+plan\s*=\s*['"]free['"]$/),
    hint: "Use city = 'Mumbai' OR NOT plan = 'Free'.",
    result: result(['name'], customers.filter((c) => c.city === 'Mumbai' || c.plan !== 'Free').map(({ name }) => ({ name }))),
    tables: ['customers'],
  },
  {
    section: 'Operators',
    subsection: 'LIKE wildcards',
    title: 'Match text patterns',
    summary: 'LIKE compares text to a pattern. The % wildcard means any number of characters, and _ means one character.',
    bullets: ['A% starts with A.', '%a% contains a.', "_en matches three-character values ending in en."],
    example: "SELECT name FROM customers WHERE name LIKE 'A%';",
    prompt: 'Find names that start with A.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+name\s+from\s+customers\s+where\s+name\s+like\s+['"]a%['"]$/),
    hint: "Use WHERE name LIKE 'A%'.",
    result: result(['name'], customers.filter((c) => c.name.startsWith('A')).map(({ name }) => ({ name }))),
    tables: ['customers'],
  },
  {
    section: 'Operators',
    subsection: 'IN BETWEEN NULL',
    title: 'Set, range, and null checks',
    summary: 'IN checks membership, BETWEEN checks a range, and IS NULL / IS NOT NULL checks missing values.',
    bullets: ['IN is cleaner than many OR checks.', 'BETWEEN includes both endpoints in standard SQL examples.', 'Use IS NULL, not = NULL.'],
    example: "SELECT name FROM customers WHERE city IN ('Chennai', 'Mumbai') AND total_spent BETWEEN 1000 AND 8000;",
    prompt: 'Find names in Chennai or Mumbai with spending from 1000 through 8000.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+name\s+from\s+customers\s+where\s+city\s+in\s*\(\s*['"]chennai['"]\s*,\s*['"]mumbai['"]\s*\)\s+and\s+total_spent\s+between\s+1000\s+and\s+8000$/),
    hint: "Use city IN ('Chennai', 'Mumbai') AND total_spent BETWEEN 1000 AND 8000.",
    result: result(['name'], customers.filter((c) => ['Chennai', 'Mumbai'].includes(c.city) && c.total_spent >= 1000 && c.total_spent <= 8000).map(({ name }) => ({ name }))),
    tables: ['customers'],
  },
  {
    section: 'Clauses',
    subsection: 'ORDER BY LIMIT',
    title: 'Sort and limit rows',
    summary: 'ORDER BY sorts the result. LIMIT / TOP / ROWNUM style clauses keep only part of the sorted result depending on the database.',
    bullets: ['ASC sorts low to high.', 'DESC sorts high to low.', 'LIMIT is common in MySQL, PostgreSQL, and SQLite; SQL Server uses TOP.'],
    example: 'SELECT name, total_spent FROM customers ORDER BY total_spent DESC LIMIT 3;',
    prompt: 'Show the top 3 customers by spending.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+name\s*,\s*total_spent\s+from\s+customers\s+order\s+by\s+total_spent\s+desc\s+limit\s+3$/),
    hint: 'Use ORDER BY total_spent DESC LIMIT 3.',
    result: result(['name', 'total_spent'], [...customers].sort((a, b) => b.total_spent - a.total_spent).slice(0, 3).map(({ name, total_spent }) => ({ name, total_spent }))),
    tables: ['customers'],
  },
  {
    section: 'Aggregation Functions',
    subsection: 'COUNT SUM AVG',
    title: 'Summarize rows',
    summary: 'Aggregate functions return one value from many rows. The essentials are COUNT, SUM, AVG, MIN, and MAX.',
    bullets: ['COUNT(*) counts rows.', 'SUM and AVG need numeric columns.', 'MIN and MAX find the smallest and largest values.'],
    example: 'SELECT COUNT(*), SUM(amount), AVG(amount), MIN(amount), MAX(amount) FROM orders;',
    prompt: 'Calculate COUNT(*), SUM(amount), and AVG(amount) from orders.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+count\(\*\)\s*,\s*sum\(amount\)\s*,\s*avg\(amount\)\s+from\s+orders$/),
    hint: 'Use SELECT COUNT(*), SUM(amount), AVG(amount) FROM orders.',
    result: result(['count', 'sum', 'avg'], [{ count: orders.length, sum: orders.reduce((a, o) => a + o.amount, 0), avg: Math.round(orders.reduce((a, o) => a + o.amount, 0) / orders.length) }]),
    tables: ['orders'],
  },
  {
    section: 'Aggregation Functions',
    subsection: 'GROUP BY HAVING',
    title: 'Group and filter summaries',
    summary: 'GROUP BY creates buckets. HAVING filters those buckets after aggregation.',
    bullets: ['GROUP BY every non-aggregated selected column.', 'WHERE filters rows before grouping.', 'HAVING filters groups after aggregate values exist.'],
    example: 'SELECT city, COUNT(*) FROM customers GROUP BY city HAVING COUNT(*) > 1;',
    prompt: 'Count customers by city and keep cities with more than one customer.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+city\s*,\s*count\(\*\)\s+from\s+customers\s+group\s+by\s+city\s+having\s+count\(\*\)\s*>\s*1$/),
    hint: 'Use GROUP BY city HAVING COUNT(*) > 1.',
    result: result(['city', 'count'], Object.entries(customers.reduce<Record<string, number>>((a, c) => ((a[c.city] = (a[c.city] || 0) + 1), a), {})).filter(([, count]) => count > 1).map(([city, count]) => ({ city, count }))),
    tables: ['customers'],
  },
  {
    section: 'Joins',
    subsection: 'INNER JOIN',
    title: 'Match rows in two tables',
    summary: 'INNER JOIN returns rows where both tables match on the join condition.',
    bullets: ['JOIN is commonly shorthand for INNER JOIN.', 'ON explains how rows relate.', 'Qualified names avoid ambiguity.'],
    example: 'SELECT customers.name, orders.item FROM customers INNER JOIN orders ON customers.id = orders.customer_id;',
    prompt: 'Show each order item with the customer name.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+customers\.name\s*,\s*orders\.item\s+from\s+customers\s+(inner\s+)?join\s+orders\s+on\s+customers\.id\s*=\s*orders\.customer_id$/),
    hint: 'Join orders ON customers.id = orders.customer_id.',
    result: result(['name', 'item'], orders.map((o) => ({ name: customers.find((c) => c.id === o.customer_id)?.name, item: o.item }))),
    tables: ['customers', 'orders'],
  },
  {
    section: 'Joins',
    subsection: 'LEFT RIGHT FULL SELF',
    title: 'Keep unmatched rows',
    summary: 'Outer joins keep unmatched rows from one or both sides. Self joins compare rows in the same table.',
    bullets: ['LEFT JOIN keeps every left-table row.', 'RIGHT JOIN keeps every right-table row.', 'FULL OUTER JOIN keeps unmatched rows from both sides; SELF JOIN uses aliases.'],
    example: 'SELECT customers.name, orders.item FROM customers LEFT JOIN orders ON customers.id = orders.customer_id;',
    prompt: 'Use LEFT JOIN to keep all customers and show any order item.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^select\s+customers\.name\s*,\s*orders\.item\s+from\s+customers\s+left\s+join\s+orders\s+on\s+customers\.id\s*=\s*orders\.customer_id$/),
    hint: 'Use customers LEFT JOIN orders ON customers.id = orders.customer_id.',
    result: result(['name', 'item'], customers.flatMap((c) => {
      const matched = orders.filter((o) => o.customer_id === c.id);
      return matched.length ? matched.map((o) => ({ name: c.name, item: o.item })) : [{ name: c.name, item: null as any }];
    })),
    tables: ['customers', 'orders'],
  },
  {
    section: 'Set Logic',
    subsection: 'UNION UNION ALL',
    title: 'Stack compatible results',
    summary: 'UNION combines result sets and removes duplicates. UNION ALL keeps duplicates.',
    bullets: ['Both queries need the same number of columns.', 'Column types should be compatible.', 'Use UNION ALL when duplicates are meaningful or speed matters.'],
    example: "SELECT city FROM customers UNION SELECT 'Pune' AS city;",
  },
  {
    section: 'Subqueries',
    subsection: 'EXISTS ANY ALL',
    title: 'Ask questions inside questions',
    summary: 'Subqueries let one query depend on another. EXISTS checks whether a subquery returns rows; ANY and ALL compare against a set.',
    bullets: ['EXISTS is common for parent-child checks.', 'ANY means at least one comparison is true.', 'ALL means every comparison is true.'],
    example: 'SELECT name FROM customers WHERE EXISTS (SELECT 1 FROM orders WHERE orders.customer_id = customers.id);',
  },
  {
    section: 'Expressions',
    subsection: 'Aliases CASE comments',
    title: 'Shape readable output',
    summary: 'Aliases rename values, CASE creates conditional values, null functions handle missing data, and comments document intent.',
    bullets: ['AS names a column or table alias.', 'CASE returns a value based on conditions.', '-- and /* */ are common SQL comment forms.'],
    example: "SELECT name AS customer_name, CASE WHEN total_spent > 5000 THEN 'VIP' ELSE 'Standard' END AS tier FROM customers;",
  },
  {
    section: 'DML',
    subsection: 'INSERT',
    title: 'Add rows',
    summary: 'INSERT INTO adds new rows. INSERT INTO SELECT copies rows from a query into another table.',
    bullets: ['Name the target columns for safer inserts.', 'VALUES supplies literal row values.', 'INSERT INTO SELECT moves data between compatible shapes.'],
    example: "INSERT INTO products (id, sku, category) VALUES (206, 'HD-01', 'Audio');",
    prompt: 'Insert an Audio product with id 206 and sku HD-01.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^insert\s+into\s+products\s*\(\s*id\s*,\s*sku\s*,\s*category\s*\)\s+values\s*\(\s*206\s*,\s*['"]hd-01['"]\s*,\s*['"]audio['"]\s*\)$/),
    hint: "Use INSERT INTO products (id, sku, category) VALUES (206, 'HD-01', 'Audio').",
    result: result([], [], 'INSERT 1'),
    tables: ['products'],
  },
  {
    section: 'DML',
    subsection: 'UPDATE DELETE',
    title: 'Change or remove rows',
    summary: 'UPDATE changes existing rows. DELETE removes rows. Both are dangerous without a careful WHERE clause.',
    bullets: ['UPDATE uses SET for new values.', 'DELETE FROM table removes matching rows.', 'A missing WHERE can affect the whole table.'],
    example: "UPDATE customers SET plan = 'Team' WHERE name = 'Ben';\nDELETE FROM customers WHERE plan = 'Free';",
    prompt: "Change Ben's plan to Team.",
    starter: editorPrompt,
    check: (sql) => has(sql, /^update\s+customers\s+set\s+plan\s*=\s*['"]team['"]\s+where\s+name\s*=\s*['"]ben['"]$/),
    hint: "Use UPDATE customers SET plan = 'Team' WHERE name = 'Ben'.",
    result: result([], [], 'UPDATE 1'),
    tables: ['customers'],
  },
  {
    section: 'DDL',
    subsection: 'CREATE TABLE',
    title: 'Create table structure',
    summary: 'CREATE TABLE defines column names, data types, and optional constraints before rows exist.',
    bullets: ['Primary keys identify rows.', 'Data types describe what each column stores.', 'Constraints make invalid data harder to insert.'],
    example: 'CREATE TABLE products (id INT PRIMARY KEY, sku TEXT NOT NULL, category TEXT);',
    prompt: 'Create products with id primary key, sku, and category.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^create\s+table\s+products\s*\(\s*id\s+int\s+primary\s+key\s*,\s*sku\s+text\s+not\s+null\s*,\s*category\s+text\s*\)$/),
    hint: 'Use CREATE TABLE products (id INT PRIMARY KEY, sku TEXT NOT NULL, category TEXT).',
    result: result([], [], 'CREATE TABLE products'),
    schemaPatch: { tables: [productTable] },
  },
  {
    section: 'DDL',
    subsection: 'ALTER ADD COLUMN',
    title: 'Change an existing table',
    summary: 'ALTER TABLE changes table structure, commonly adding, dropping, or altering columns and constraints.',
    bullets: ['ADD COLUMN introduces a new attribute.', 'DROP COLUMN removes one.', 'ALTER COLUMN changes a column definition in databases that support it.'],
    example: 'ALTER TABLE products ADD COLUMN active BOOLEAN;',
    prompt: 'Add an active boolean column to products.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^alter\s+table\s+products\s+add\s+column\s+active\s+boolean$/),
    hint: 'Use ALTER TABLE products ADD COLUMN active BOOLEAN.',
    result: result([], [], 'ALTER TABLE products'),
    schemaPatch: { tables: [{ ...productTable, columns: [...productTable.columns, { name: 'active', type: 'boolean', pk: false }] }] },
  },
  {
    section: 'Constraints',
    subsection: 'Primary and foreign keys',
    title: 'Connect tables with keys',
    summary: 'Primary keys identify rows. Foreign keys connect child rows to parent rows and protect relationships.',
    bullets: ['PRIMARY KEY enforces row identity.', 'FOREIGN KEY points to another table.', 'REFERENCES names the parent table and column.'],
    example: 'CREATE TABLE line_items (id INT PRIMARY KEY, order_id INT, product_id INT, quantity INT, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id));',
    prompt: 'Create line_items with foreign keys to orders and products.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^create\s+table\s+line_items\s*\(\s*id\s+int\s+primary\s+key\s*,\s*order_id\s+int\s*,\s*product_id\s+int\s*,\s*quantity\s+int\s*,\s*foreign\s+key\s*\(\s*order_id\s*\)\s+references\s+orders\s*\(\s*id\s*\)\s*,\s*foreign\s+key\s*\(\s*product_id\s*\)\s+references\s+products\s*\(\s*id\s*\)\s*\)$/),
    hint: 'Include both FOREIGN KEY clauses: order_id -> orders(id), product_id -> products(id).',
    result: result([], [], 'CREATE TABLE line_items'),
    schemaPatch: {
      tables: [productTable, lineItemTable],
      relations: [
        { from_table: 'line_items', from_col: 'order_id', to_table: 'orders', to_col: 'id' },
        { from_table: 'line_items', from_col: 'product_id', to_table: 'products', to_col: 'id' },
      ],
    },
  },
  {
    section: 'Constraints',
    subsection: 'NOT NULL UNIQUE CHECK DEFAULT',
    title: 'Protect valid values',
    summary: 'Constraints are rules: NOT NULL requires a value, UNIQUE prevents duplicates, CHECK validates expressions, and DEFAULT supplies a value.',
    bullets: ['Use NOT NULL for required columns.', 'UNIQUE is common for email or SKU.', 'CHECK and DEFAULT encode simple business rules in the database.'],
    example: "CREATE TABLE users (id INT PRIMARY KEY, email TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'active', CHECK (status IN ('active', 'paused')));",
  },
  {
    section: 'DDL',
    subsection: 'DROP TRUNCATE',
    title: 'Remove data or objects',
    summary: 'DROP removes database objects. TRUNCATE removes all rows from a table while keeping the table structure.',
    bullets: ['DROP TABLE removes the table definition.', 'DROP DATABASE removes a database.', 'TRUNCATE TABLE is bulk row removal in databases that support it.'],
    example: 'DROP TABLE products;\nTRUNCATE TABLE orders;',
    prompt: 'Drop the products table.',
    starter: editorPrompt,
    check: (sql) => has(sql, /^drop\s+table\s+products$/),
    hint: 'Use DROP TABLE products.',
    result: result([], [], 'DROP TABLE products'),
    schemaPatch: { drop: ['products'] },
  },
  {
    section: 'Database Objects',
    subsection: 'Indexes',
    title: 'Create indexes',
    summary: 'CREATE INDEX adds a lookup structure that can speed filters, joins, and sorts. UNIQUE INDEX also enforces uniqueness.',
    bullets: ['Indexes speed some reads.', 'Indexes cost storage and write work.', 'Index columns used by real query patterns.'],
    example: 'CREATE INDEX idx_orders_customer_id ON orders (customer_id);\nCREATE UNIQUE INDEX idx_products_sku ON products (sku);',
  },
  {
    section: 'Database Objects',
    subsection: 'Views and procedures',
    title: 'Save reusable logic',
    summary: 'Views save a query as a virtual table. Stored procedures save database-side logic that can be executed later.',
    bullets: ['CREATE VIEW exposes a named query.', 'CREATE OR REPLACE VIEW updates a view where supported.', 'Stored procedure syntax varies widely by database.'],
    example: 'CREATE VIEW customer_totals AS SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id;',
  },
  {
    section: 'Safety',
    subsection: 'Injection and parameters',
    title: 'Write safe SQL',
    summary: 'SQL injection happens when user input is mixed into SQL text as code. Parameters keep input as data.',
    bullets: ['Avoid string-building SQL from user input.', 'Use prepared statements or parameterized APIs.', 'Validate identifiers separately when dynamic table or column names are unavoidable.'],
    example: 'SELECT * FROM users WHERE email = ?;',
  },
];

function datasetResult(table: 'customers' | 'orders' | 'products') {
  const rows = table === 'customers' ? customers : table === 'orders' ? orders : products;
  return { ok: true, columns: Object.keys(rows[0]), rows, row_count: rows.length, truncated: false };
}

function applyPatch(tables: SchemaTable[], relations: Relation[], patch?: SchemaPatch) {
  if (!patch) return { tables, relations };
  const dropped = new Set(patch.drop || []);
  const nextTables = tables.filter((t) => !dropped.has(t.name));
  for (const table of patch.tables || []) {
    const i = nextTables.findIndex((t) => t.name === table.name);
    if (i >= 0) nextTables[i] = table;
    else nextTables.push(table);
  }
  const relKey = (r: Relation) => `${r.from_table}.${r.from_col}->${r.to_table}.${r.to_col}`;
  const nextRelations = [...relations, ...(patch.relations || [])]
    .filter((r) => !dropped.has(r.from_table) && !dropped.has(r.to_table))
    .filter((r, i, all) => all.findIndex((x) => relKey(x) === relKey(r)) === i);
  return { tables: nextTables, relations: nextRelations };
}

export default function FundamentalsSqlPage() {
  const [index, setIndex] = useState(0);
  const [sql, setSql] = useState(editorPrompt);
  const [status, setStatus] = useState<'idle' | 'pass' | 'fail'>('idle');
  const [schema, setSchema] = useState({ tables: baseSchema, relations: baseRelations });
  const current = lessons[index];
  const progress = Math.round(((index + 1) / lessons.length) * 100);
  const practice = Boolean(current.check);
  const grouped = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    lessons.forEach((l) => map.set(l.section, [...(map.get(l.section) || []), l]));
    return Array.from(map.entries());
  }, []);
  const shownResult = status === 'pass' && current.result ? { ok: true, ...current.result, row_count: current.result.rows.length, truncated: false } : null;

  function go(next: number) {
    setIndex(Math.max(0, Math.min(lessons.length - 1, next)));
    setSql(editorPrompt);
    setStatus('idle');
  }

  function run() {
    if (!current.check) return;
    const ok = current.check(sql);
    setStatus(ok ? 'pass' : 'fail');
    if (ok && current.schemaPatch) {
      setSchema((s) => applyPatch(s.tables, s.relations, current.schemaPatch));
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0d11] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_88%_88%,rgba(57,169,246,0.28),transparent_44%),linear-gradient(135deg,#090a0d_0%,#101721_56%,#08111a_100%)]" />
      <div className="fixed inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative flex min-h-screen">
        <aside className="hidden w-80 shrink-0 border-r border-white/10 bg-black/25 p-5 backdrop-blur xl:block">
          <Link href="/paths" className="text-sm text-white/60 hover:text-white">Exit course</Link>
          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">Fundamentals map</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 text-xs text-white/55">Topic {index + 1}/{lessons.length}</div>
          </div>
          <nav className="mt-6 max-h-[calc(100vh-150px)] space-y-4 overflow-auto pr-1">
            {grouped.map(([section, items]) => (
              <div key={section}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-200/80">{section}</div>
                <div className="space-y-1">
                  {items.map((item) => {
                    const i = lessons.indexOf(item);
                    return (
                      <button
                        key={`${item.section}-${item.subsection}-${item.title}`}
                        onClick={() => go(i)}
                        className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${i === index ? 'bg-white text-ink' : 'text-white/68 hover:bg-white/10 hover:text-white'}`}
                      >
                        <span className="block truncate font-medium">{item.subsection}</span>
                        <span className="block truncate text-xs opacity-60">{item.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col p-5 lg:p-8">
          <div className="mb-5 flex items-start justify-between gap-4 xl:hidden">
            <Link href="/paths" className="text-sm text-white/60 hover:text-white">Exit course</Link>
            <select
              value={index}
              onChange={(e) => go(Number(e.target.value))}
              className="max-w-[68vw] rounded-md border border-white/15 bg-[#111827] px-3 py-2 text-sm text-white"
            >
              {lessons.map((l, i) => (
                <option key={`${l.title}-${i}`} value={i}>
                  {l.section} / {l.subsection}
                </option>
              ))}
            </select>
          </div>

          <section className="grid min-h-0 flex-1 grid-cols-1 gap-5 2xl:grid-cols-[minmax(360px,0.74fr)_minmax(0,1.26fr)]">
            <div className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-200/80">{current.section} / {current.subsection}</div>
              <h1 className="mt-4 text-4xl font-semibold tracking-normal">{current.title}</h1>
              <p className="mt-4 text-base leading-7 text-white/72">{current.summary}</p>
              <ul className="mt-5 space-y-2 text-sm leading-6 text-white/64">
                {current.bullets.map((b) => <li key={b}>- {b}</li>)}
              </ul>
              <pre className="mt-5 overflow-auto rounded-md border border-white/10 bg-black/35 p-4 font-mono text-sm leading-7 text-emerald-100">{current.example}</pre>
              {current.tables && (
                <div className="mt-5 min-h-0 overflow-auto">
                  <div className="mb-2 text-sm font-semibold text-white/85">Practice data</div>
                  <div className="space-y-3">
                    {current.tables.map((table) => (
                      <div key={table} className="overflow-hidden rounded-md border border-white/10 bg-white">
                        <div className="border-b border-line bg-canvas px-3 py-2 font-mono text-xs font-semibold text-ink">{table}</div>
                        <div className="h-32 text-ink"><ResultsTable result={datasetResult(table)} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-6">
                <button className="btn" disabled={index === 0} onClick={() => go(index - 1)}>Back</button>
                <button className="btn btn-primary" disabled={index === lessons.length - 1 || (practice && status !== 'pass')} onClick={() => go(index + 1)}>Next</button>
                <button className="btn" onClick={() => setSchema({ tables: baseSchema, relations: baseRelations })}>Reset schema</button>
              </div>
            </div>

            <div className="grid min-h-[720px] grid-rows-[minmax(330px,0.95fr)_minmax(300px,1.05fr)] gap-5">
              <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl">
                <div className="border-b border-line p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-sub">Interactive editor</div>
                  <p className="mt-1 text-sm text-ink">{current.prompt || 'Read this topic, then continue. Practice appears on runnable lessons.'}</p>
                </div>
                <div className="min-h-0 flex-1">
                  <Editor
                    height="100%"
                    defaultLanguage="sql"
                    theme="vs"
                    value={sql}
                    onChange={(value) => setSql(value || '')}
                    options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16 }, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', renderLineHighlight: 'none' }}
                  />
                </div>
                <div className="flex h-44 min-h-0 flex-col border-t border-line">
                  <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-sub">Result</div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {status === 'pass' && <span className="text-xs font-medium text-ok">Correct</span>}
                      {status === 'fail' && <span className="max-w-80 truncate text-xs font-medium text-bad">{current.hint}</span>}
                      <button className="btn !py-1" onClick={() => { setSql(current.starter || editorPrompt); setStatus('idle'); }}>Reset</button>
                      <button className="btn btn-primary !py-1" disabled={!practice} onClick={run}>Run Check</button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 text-ink">
                    {!practice ? (
                      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-sub">Concept topic. Jump to the next editor lesson when ready.</div>
                    ) : status === 'idle' ? (
                      <div className="flex h-full items-center justify-center text-sm text-sub">Run the query when you are ready.</div>
                    ) : status === 'fail' ? (
                      <div className="m-4 rounded-md border border-bad/30 bg-bad/5 p-3 text-sm text-bad">The query is close. Use the statement pattern shown on this topic.</div>
                    ) : (
                      <ResultsTable result={shownResult} />
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-white shadow-2xl">
                <SchemaCanvas tables={schema.tables} relations={schema.relations} storageKey="fundamentals-sql-live-schema" />
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
