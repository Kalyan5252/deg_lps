// Schema-aware SQL autocomplete for the Monaco editor.
//
// Suggests, as you type:
//   * table names from the current track's schema
//   * column names (and `table.` -> that table's columns)
//   * SQL clauses / keywords / common functions
//
// Register once on editor mount, passing a getter so the provider always reads
// the latest schema (which loads asynchronously after mount).

export type SchemaColumn = { name: string; type?: string };
export type SchemaTable = { name: string; columns: SchemaColumn[] };
export type SchemaGetter = () => { tables?: SchemaTable[] };

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "FULL JOIN", "CROSS JOIN",
  "ON", "AS", "AND", "OR", "NOT", "IN", "IS NULL", "IS NOT NULL", "LIKE",
  "ILIKE", "BETWEEN", "DISTINCT", "UNION", "UNION ALL", "EXCEPT", "INTERSECT",
  "CASE", "WHEN", "THEN", "ELSE", "END", "ASC", "DESC", "WITH", "OVER",
  "PARTITION BY", "USING", "EXISTS", "COALESCE", "CAST",
];

const FUNCTIONS = [
  "count", "sum", "avg", "min", "max", "round", "abs", "ceil", "floor",
  "lower", "upper", "trim", "length", "coalesce", "nullif", "concat",
  "date_trunc", "extract", "now", "to_char", "row_number", "rank", "dense_rank",
  "lag", "lead", "string_agg", "array_agg",
];

export function registerSqlCompletion(monaco: any, getSchema: SchemaGetter) {
  const K = monaco.languages.CompletionItemKind;

  return monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " ", "(", ",", "\n"],
    provideCompletionItems(model: any, position: any) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const lineToCursor: string = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const tables = getSchema()?.tables ?? [];
      const suggestions: any[] = [];

      // `alias.` or `table.` -> that table's columns
      const dot = lineToCursor.match(/([A-Za-z_]\w*)\.\w*$/);
      if (dot) {
        const ref = dot[1].toLowerCase();
        // match by table name, or by an alias declared as `<table> <alias>`
        let t = tables.find((x) => x.name.toLowerCase() === ref);
        if (!t) {
          const full = model.getValue();
          const aliasRe = new RegExp(
            `([A-Za-z_]\\w*)\\s+(?:AS\\s+)?${ref}\\b`, "i");
          const m = full.match(aliasRe);
          if (m) t = tables.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
        }
        if (t) {
          for (const c of t.columns) {
            suggestions.push({
              label: c.name, kind: K.Field, insertText: c.name,
              detail: c.type || "column", range, sortText: "0" + c.name,
            });
          }
          return { suggestions };
        }
      }

      // tables
      for (const t of tables) {
        suggestions.push({
          label: t.name, kind: K.Struct, insertText: t.name,
          detail: `table · ${t.columns.length} cols`, range, sortText: "0" + t.name,
        });
      }
      // columns (with table hint)
      const seen = new Set<string>();
      for (const t of tables) {
        for (const c of t.columns) {
          const key = c.name.toLowerCase();
          suggestions.push({
            label: c.name, kind: K.Field, insertText: c.name,
            detail: `${t.name}.${c.name}`, range,
            sortText: (seen.has(key) ? "2" : "1") + c.name,
          });
          seen.add(key);
        }
      }
      // keywords + functions
      for (const kw of KEYWORDS) {
        suggestions.push({
          label: kw, kind: K.Keyword, insertText: kw, range, sortText: "3" + kw,
        });
      }
      for (const fn of FUNCTIONS) {
        suggestions.push({
          label: fn, kind: K.Function,
          insertText: `${fn}($0)`,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: "function", range, sortText: "4" + fn,
        });
      }
      return { suggestions };
    },
  });
}
