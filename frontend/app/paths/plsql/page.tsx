import StoryCourse from "../_components/StoryCourse";

const slides = [
  {
    eyebrow: "PL/SQL",
    title: "Procedural Language for SQL",
    body: "PL/SQL stands for Procedural Language for SQL. It extends SQL with variables, conditions, loops, exceptions, procedures, and functions.",
    accent: "SQL asks for data. PL/SQL packages database logic.",
  },
  {
    eyebrow: "Screen 2",
    title: "Why PL/SQL exists",
    body: "Some work needs more than one query: validate input, run multiple statements, handle errors, and return a result. PL/SQL keeps that logic close to the database.",
  },
  {
    eyebrow: "Screen 3",
    title: "Anonymous blocks",
    body: "An anonymous block is a one-off PL/SQL program. It has declaration, execution, and optional exception sections.",
    example: "DECLARE\n  v_count NUMBER;\nBEGIN\n  SELECT COUNT(*) INTO v_count FROM customers;\nEND;",
  },
  {
    eyebrow: "Screen 4",
    title: "Variables",
    body: "Variables store values while the block runs. They make multi-step database logic readable and reusable.",
    example: "v_total NUMBER := 0;",
  },
  {
    eyebrow: "Screen 5",
    title: "SELECT INTO",
    body: "SELECT INTO reads query output into PL/SQL variables. It is common when a later step depends on a value from the database.",
    example: "SELECT total_spent INTO v_total FROM customers WHERE id = 1;",
  },
  {
    eyebrow: "Screen 6",
    title: "Conditions",
    body: "IF statements let PL/SQL choose different actions based on data or input.",
    example: "IF v_total > 1000 THEN\n  v_tier := 'VIP';\nEND IF;",
  },
  {
    eyebrow: "Screen 7",
    title: "Loops",
    body: "Loops repeat logic. They are useful for controlled procedural tasks, but set-based SQL is usually better for bulk data changes.",
  },
  {
    eyebrow: "Screen 8",
    title: "Cursors",
    body: "A cursor lets PL/SQL process query results row by row. Use them carefully because row-by-row work can be slower than set-based SQL.",
  },
  {
    eyebrow: "Screen 9",
    title: "Procedures",
    body: "A procedure is a named PL/SQL program that performs an action. It can take parameters and be called repeatedly.",
    example: "CREATE PROCEDURE close_order(p_order_id NUMBER) AS\nBEGIN\n  UPDATE orders SET status = 'closed' WHERE id = p_order_id;\nEND;",
  },
  {
    eyebrow: "Screen 10",
    title: "Functions",
    body: "A function returns a value. It is useful for reusable calculations, validations, or transformations.",
    example: "CREATE FUNCTION tax_for(p_amount NUMBER) RETURN NUMBER AS ...",
  },
  {
    eyebrow: "Screen 11",
    title: "Packages",
    body: "A package groups related procedures, functions, types, and variables. It creates a clean API inside the database.",
  },
  {
    eyebrow: "Screen 12",
    title: "Exceptions",
    body: "Exception handling lets PL/SQL respond to errors in a controlled way, such as missing rows or duplicate keys.",
    example: "EXCEPTION\n  WHEN NO_DATA_FOUND THEN\n    v_status := 'missing';",
  },
  {
    eyebrow: "Screen 13",
    title: "Transactions",
    body: "PL/SQL often runs multiple changes together. COMMIT saves them; ROLLBACK cancels them. Transaction boundaries matter.",
  },
  {
    eyebrow: "Screen 14",
    title: "When not to use PL/SQL",
    body: "Do not use procedural loops for work SQL can do in one set-based statement. Keep business logic placement intentional.",
  },
  {
    eyebrow: "Screen 15",
    title: "PL/SQL mindset",
    body: "Use PL/SQL when database-side workflow, validation, reuse, or error handling truly belongs near the data.",
    accent: "Procedural power is best when it protects clarity.",
  },
];

export default function PlsqlCoursePage() {
  return <StoryCourse title="PL/SQL" slides={slides} />;
}
