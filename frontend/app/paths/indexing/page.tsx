import StoryCourse from "../_components/StoryCourse";

const slides = [
  {
    eyebrow: "Indexing",
    title: "Indexes and Why They Exist",
    body: "An index is a helper structure that lets the database find rows without reading the whole table. It is like a sorted lookup beside the data.",
    accent: "Indexes trade storage and write cost for faster reads.",
  },
  {
    eyebrow: "Screen 2",
    title: "The table scan problem",
    body: "Without an index, the database may inspect every row to answer a selective question. On tiny tables this is fine. On million-row tables, it becomes painful.",
    example: "SELECT * FROM orders WHERE customer_id = 42;",
  },
  {
    eyebrow: "Screen 3",
    title: "What an index stores",
    body: "Most common indexes store keys in sorted order with pointers back to table rows. The database can jump to the matching key range instead of searching blindly.",
  },
  {
    eyebrow: "Screen 4",
    title: "Primary key indexes",
    body: "A primary key identifies each row. Databases usually create an index for it automatically because lookups by identity are common.",
    example: "CREATE TABLE customers (id BIGINT PRIMARY KEY, email TEXT);",
  },
  {
    eyebrow: "Screen 5",
    title: "Foreign key indexes",
    body: "A foreign key links one table to another. Indexing foreign key columns often speeds joins and child-table lookups.",
    example: "CREATE INDEX idx_orders_customer_id ON orders (customer_id);",
  },
  {
    eyebrow: "Screen 6",
    title: "Single-column indexes",
    body: "A single-column index helps when filters, joins, or sorts commonly use one column.",
    example: "CREATE INDEX idx_customers_city ON customers (city);",
  },
  {
    eyebrow: "Screen 7",
    title: "Composite indexes",
    body: "A composite index uses multiple columns in order. The leftmost column matters most because it decides where the sorted structure begins.",
    example: "CREATE INDEX idx_orders_customer_status ON orders (customer_id, status);",
  },
  {
    eyebrow: "Screen 8",
    title: "Indexes for ORDER BY",
    body: "Indexes can help sorting when the query orders by indexed columns. This avoids sorting large result sets after reading them.",
    example: "CREATE INDEX idx_orders_created_at ON orders (created_at DESC);",
  },
  {
    eyebrow: "Screen 9",
    title: "Covering indexes",
    body: "A covering index contains every column needed by a query. The database can answer from the index with fewer table reads.",
    example: "CREATE INDEX idx_orders_cover ON orders (customer_id) INCLUDE (status, created_at);",
  },
  {
    eyebrow: "Screen 10",
    title: "Unique indexes",
    body: "A unique index improves lookup speed and enforces a rule: no two rows can have the same value for those indexed columns.",
    example: "CREATE UNIQUE INDEX idx_users_email ON users (email);",
  },
  {
    eyebrow: "Screen 11",
    title: "Partial indexes",
    body: "A partial index covers only rows that match a condition. It is useful when a query repeatedly touches a small active slice of a table.",
    example: "CREATE INDEX idx_open_orders ON orders (created_at) WHERE status = 'open';",
  },
  {
    eyebrow: "Screen 12",
    title: "When indexes hurt",
    body: "Indexes are not free. Every insert, update, and delete may also update indexes. Too many indexes can slow writes and increase storage.",
  },
  {
    eyebrow: "Screen 13",
    title: "Reading the plan",
    body: "Use EXPLAIN to see whether the database chose a sequential scan, index scan, bitmap scan, or another plan.",
    example: "EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;",
  },
  {
    eyebrow: "Screen 14",
    title: "Index design checklist",
    body: "Index columns used in frequent filters, joins, and sorts. Prefer indexes that support real queries, not theoretical possibilities.",
  },
  {
    eyebrow: "Screen 15",
    title: "Indexing mindset",
    body: "Start from the slow query, inspect the access pattern, add the smallest useful index, measure again, and remove unused indexes over time.",
    accent: "Indexes are performance tools, not decorations.",
  },
];

export default function IndexingCoursePage() {
  return <StoryCourse title="Indexing" slides={slides} />;
}
