"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const STATUS_STYLE: Record<string, string> = {
  running: "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  error: "bg-red-100 text-red-700",
  skipped: "bg-gray-100 text-gray-500",
};

function Pill({ status }: { status: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        STATUS_STYLE[status] || "bg-gray-100 text-gray-600"
      }`}
    >
      {status}
    </span>
  );
}

export default function ActivityPanel({
  pipelineId,
  activeRunId,
  onClose,
}: {
  pipelineId: number | string;
  activeRunId: number | null;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<any[]>([]);
  const [openRun, setOpenRun] = useState<number | null>(activeRunId);
  const [logs, setLogs] = useState<any[]>([]);
  const timer = useRef<any>(null);

  function loadRuns() {
    api.pipelineRuns(pipelineId).then(setRuns).catch(() => {});
  }
  useEffect(loadRuns, [pipelineId, activeRunId]);

  useEffect(() => {
    if (activeRunId) setOpenRun(activeRunId);
  }, [activeRunId]);

  // poll logs for the open run (and refresh run list) while it may be running
  useEffect(() => {
    if (openRun == null) return;
    let stop = false;
    async function tick() {
      try {
        const [l] = await Promise.all([api.pipelineRunLogs(openRun as number)]);
        if (!stop) setLogs(l);
      } catch {
        /* noop */
      }
      const run = runs.find((r) => r.id === openRun);
      if (run && run.status === "running") loadRuns();
    }
    tick();
    timer.current = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRun]);

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">Activity</div>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-md text-sub hover:bg-canvas hover:text-ink"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {runs.length === 0 && (
          <div className="p-4 text-xs text-sub">
            No runs yet. Hit <b>Run</b> to execute the pipeline.
          </div>
        )}
        {runs.map((r) => (
          <div key={r.id} className="border-b border-line">
            <button
              className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-canvas"
              onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
            >
              <div className="flex items-center gap-2">
                <Pill status={r.status} />
                <span className="text-xs font-medium">Run #{r.id}</span>
              </div>
              <span className="text-[11px] text-sub">
                {r.stats?.ok ?? 0}/{r.stats?.nodes ?? 0} ok
              </span>
            </button>

            {openRun === r.id && (
              <div className="space-y-2 bg-canvas/40 px-3 pb-3">
                {logs.length === 0 && (
                  <div className="px-1 py-2 text-[11px] text-sub">
                    No node activity recorded.
                  </div>
                )}
                {logs.map((log, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-line bg-white p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium">
                        {log.task}
                      </span>
                      <Pill status={log.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-sub">
                      <span className="font-mono">{log.node_type}</span>
                      {log.rows_out != null && <span>{log.rows_out} rows out</span>}
                      {log.duration_ms != null && (
                        <span>{log.duration_ms} ms</span>
                      )}
                    </div>
                    {(log.subtasks || []).length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {log.subtasks.map((s: any, j: number) => (
                          <li
                            key={j}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <span className="truncate text-ink/80">
                              • {s.label}
                            </span>
                            <Pill status={s.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {log.message && (
                      <div className="mt-1 rounded bg-red-50 p-1 font-mono text-[10px] text-red-600">
                        {log.message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
