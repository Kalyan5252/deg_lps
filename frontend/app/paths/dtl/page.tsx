import StoryCourse from "../_components/StoryCourse";

const slides = [
  {
    eyebrow: "DTL",
    title: "Data Transaction Language",
    body: "Data Transaction Language is how a database protects a set of changes as one unit of work. In many SQL references, this area is also called Transaction Control Language.",
    accent: "A transaction is the promise that data changes finish cleanly, or do not count.",
  },
  {
    eyebrow: "Screen 2",
    title: "Why transactions exist",
    body: "Real systems do not change one row at a time. A checkout may create an order, reduce inventory, add a payment record, and write an audit event. Those changes must succeed together.",
  },
  {
    eyebrow: "Screen 3",
    title: "Unit of work",
    body: "A transaction groups multiple statements into one logical operation. The database tracks the work until you choose to save it with COMMIT or cancel it with ROLLBACK.",
    example: "BEGIN TRANSACTION;\nUPDATE inventory SET stock = stock - 1 WHERE product_id = 7;\nINSERT INTO orders(customer_id, product_id) VALUES (42, 7);",
  },
  {
    eyebrow: "Screen 4",
    title: "COMMIT",
    body: "COMMIT makes the transaction permanent. After a successful commit, other users and future queries can rely on those changes as saved data.",
    example: "COMMIT;",
  },
  {
    eyebrow: "Screen 5",
    title: "ROLLBACK",
    body: "ROLLBACK cancels the current transaction. It is used when a validation fails, an error happens, or the operation should not be saved.",
    example: "ROLLBACK;",
  },
  {
    eyebrow: "Screen 6",
    title: "SAVEPOINT",
    body: "A savepoint marks a checkpoint inside a transaction. You can roll back part of the work without throwing away everything.",
    example: "SAVEPOINT before_discount;\nUPDATE orders SET discount = 15 WHERE id = 101;\nROLLBACK TO before_discount;",
  },
  {
    eyebrow: "Screen 7",
    title: "Atomicity",
    body: "Atomicity is the A in ACID. ACID stands for Atomicity, Consistency, Isolation, and Durability. Atomicity means all statements in the transaction count, or none of them count.",
  },
  {
    eyebrow: "Screen 8",
    title: "Consistency",
    body: "Consistency means the database moves from one valid state to another valid state. Constraints, foreign keys, and transaction rules help prevent half-valid data.",
  },
  {
    eyebrow: "Screen 9",
    title: "Isolation",
    body: "Isolation controls what one transaction can see while another transaction is still running. It prevents users from reading unstable intermediate changes.",
  },
  {
    eyebrow: "Screen 10",
    title: "Durability",
    body: "Durability means committed data should survive crashes. Once the database confirms a commit, it must protect that result through logs and storage guarantees.",
  },
  {
    eyebrow: "Screen 11",
    title: "Autocommit",
    body: "Many tools run in autocommit mode, where every statement commits immediately. That is convenient for simple reads and risky for multi-step changes.",
    example: "-- Autocommit can save this immediately:\nDELETE FROM customers WHERE id = 12;",
  },
  {
    eyebrow: "Screen 12",
    title: "Explicit transactions",
    body: "Explicit transactions are safer when multiple writes belong together. You start the transaction, run the checks, and commit only after the final state is correct.",
    example: "BEGIN;\nUPDATE accounts SET balance = balance - 500 WHERE id = 1;\nUPDATE accounts SET balance = balance + 500 WHERE id = 2;\nCOMMIT;",
  },
  {
    eyebrow: "Screen 13",
    title: "Dirty reads",
    body: "A dirty read happens when a query sees uncommitted data from another transaction. If that other transaction rolls back, the reader saw something that never truly existed.",
  },
  {
    eyebrow: "Screen 14",
    title: "Lost updates",
    body: "A lost update happens when two transactions edit the same data and one overwrites the other. Locking, isolation levels, and careful update patterns reduce this risk.",
  },
  {
    eyebrow: "Screen 15",
    title: "Deadlocks",
    body: "A deadlock happens when transactions wait on each other in a cycle. Databases detect this and cancel one transaction, so applications need retry behavior.",
  },
  {
    eyebrow: "Screen 16",
    title: "Transaction mindset",
    body: "Use transactions when correctness matters across more than one statement. Decide the boundary first, validate before commit, and keep transactions as short as practical.",
    accent: "The goal is not just changing data. The goal is changing data without leaving damage behind.",
  },
];

export default function DtlCoursePage() {
  return <StoryCourse title="DTL" slides={slides} />;
}
