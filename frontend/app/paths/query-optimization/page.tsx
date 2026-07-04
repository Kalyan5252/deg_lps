import StoryCourse from "../_components/StoryCourse";

const slides = [
  {
    eyebrow: "Optimization",
    title: "Query Optimization",
    body: "Query optimization is the practice of making SQL return the same answer with less work. The goal is not clever SQL. The goal is predictable, efficient execution.",
    accent: "Same result, less work.",
  },
  {
    eyebrow: "Screen 2",
    title: "Start with the question",
    body: "Before tuning, understand the business question. A fast wrong query is worse than a slow correct one.",
  },
  {
    eyebrow: "Screen 3",
    title: "Measure first",
    body: "Use timing and execution plans before changing SQL. Guessing at performance usually creates noise.",
    example: "EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;",
    practice: {
      prompt: "Ask the database for the execution plan and timing of the customer lookup.",
      starter: "-- inspect the plan\n",
      expected: "explain analyze select * from orders where customer_id = 42",
      hint: "Start with EXPLAIN ANALYZE, then the SELECT statement.",
      result: "Plan request accepted.",
    },
  },
  {
    eyebrow: "Screen 4",
    title: "Execution plans",
    body: "An execution plan shows how the database intends to read, join, sort, aggregate, and return rows.",
  },
  {
    eyebrow: "Screen 5",
    title: "Rows are the cost",
    body: "Most slow queries read too many rows, join too many rows, sort too many rows, or repeat work too many times.",
  },
  {
    eyebrow: "Screen 6",
    title: "Filter early",
    body: "Push selective WHERE conditions as close as possible to the source tables so later joins and aggregations handle less data.",
    example: "WHERE orders.created_at >= DATE '2026-01-01'",
  },
  {
    eyebrow: "Screen 7",
    title: "Select fewer columns",
    body: "Avoid SELECT * in production paths. Returning only needed columns reduces memory, network, and sometimes disk work.",
  },
  {
    eyebrow: "Screen 8",
    title: "Join carefully",
    body: "Join on indexed keys when possible. Check whether joins multiply rows unexpectedly, especially many-to-many joins.",
  },
  {
    eyebrow: "Screen 9",
    title: "Aggregate intentionally",
    body: "GROUP BY is powerful, but grouping huge intermediate results is expensive. Filter first, then group.",
  },
  {
    eyebrow: "Screen 10",
    title: "Sort only when needed",
    body: "ORDER BY can force a large sort. Sort final result sets, not every intermediate step, unless the order is required.",
  },
  {
    eyebrow: "Screen 11",
    title: "Use LIMIT for exploration",
    body: "LIMIT is great while exploring, but it does not always make a production query fast unless the plan can stop early.",
  },
  {
    eyebrow: "Screen 12",
    title: "Avoid repeated subqueries",
    body: "If the same expensive expression or subquery is repeated, consider a Common Table Expression (CTE), derived table, or materialized result.",
    example: "WITH recent_orders AS (...) SELECT ... FROM recent_orders;",
    practice: {
      prompt: "Create a CTE named recent_orders that selects from orders.",
      starter: "-- write a CTE shell\n",
      expected: "with recent_orders as (select * from orders) select * from recent_orders",
      hint: "Use WITH recent_orders AS (SELECT * FROM orders) SELECT * FROM recent_orders.",
      result: "CTE pattern accepted.",
    },
  },
  {
    eyebrow: "Screen 13",
    title: "Statistics matter",
    body: "The optimizer estimates row counts from statistics. Stale statistics can produce poor plans.",
    example: "ANALYZE orders;",
  },
  {
    eyebrow: "Screen 14",
    title: "Optimization workflow",
    body: "Reproduce the issue, capture the plan, identify the largest cost, change one thing, measure again, and keep notes.",
  },
  {
    eyebrow: "Screen 15",
    title: "Optimization mindset",
    body: "Optimization is disciplined investigation. You are not fighting the database; you are giving it better information and less unnecessary work.",
    accent: "Make the easy path the correct path.",
  },
];

export default function QueryOptimizationCoursePage() {
  return <StoryCourse title="Query Optimization" slides={slides} />;
}
