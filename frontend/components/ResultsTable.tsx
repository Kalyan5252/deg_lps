"use client";

export default function ResultsTable({ result }: { result: any }) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-sub">
        Run a query to see results here.
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="p-4">
        <div className="rounded-md border border-bad/30 bg-bad/5 p-3 font-mono text-xs text-bad">
          {result.error}
        </div>
      </div>
    );
  }
  if ((result.columns || []).length === 0) {
    return (
      <div className="p-4 text-sm text-sub">
        {result.command
          ? `Statement executed: ${result.command}`
          : "Query ran successfully with no result set."}
      </div>
    );
  }

  const cols: string[] = result.columns;
  const rows: any[] = result.rows;

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-canvas">
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className="border-b border-line px-3 py-2 text-left font-medium text-sub"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-canvas">
              {cols.map((c) => (
                <td
                  key={c}
                  className="border-b border-line px-3 py-1.5 font-mono text-[13px] tabular-nums"
                >
                  {r[c] === null ? (
                    <span className="text-sub italic">null</span>
                  ) : (
                    String(r[c])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
