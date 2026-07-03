"use client";

import { Handle, Position, NodeProps } from "@xyflow/react";

export const NODE_META: Record<
  string,
  { label: string; glyph: string; color: string; hint: string }
> = {
  datasource: {
    label: "Data source",
    glyph: "⛁",
    color: "#2563eb",
    hint: "CSV · public · Postgres · API · WebSocket",
  },
  function: {
    label: "Function",
    glyph: "λ",
    color: "#7c3aed",
    hint: "Python transform (validate, parse, format)",
  },
  gate: {
    label: "Conditional gate",
    glyph: "⧉",
    color: "#d97706",
    hint: "Route rows down separate paths",
  },
  llm: {
    label: "LLM node",
    glyph: "✷",
    color: "#0891b2",
    hint: "Reason over data with an AI model",
  },
  output: {
    label: "Output / Stream",
    glyph: "⇥",
    color: "#059669",
    hint: "SSE · API · WS · Sheets · Alerts",
  },
};

function subtitle(type: string, data: any): string {
  if (type === "datasource") return `source: ${data.kind || "csv"}`;
  if (type === "function") return "python transform";
  if (type === "gate")
    return `${(data.conditions || []).length} branch${
      (data.conditions || []).length === 1 ? "" : "es"
    }`;
  if (type === "llm") return data.model || "model unset";
  if (type === "output") return `target: ${data.kind || "api"}`;
  return "";
}

function Card({ type, data, selected }: NodeProps & { type: string }) {
  const meta = NODE_META[type];
  const d: any = data || {};
  return (
    <div
      className={`w-52 rounded-lg border bg-white shadow-sm transition-shadow ${
        selected ? "shadow-md" : ""
      }`}
      style={{ borderColor: selected ? meta.color : "#e5e7eb" }}
    >
      <div
        className="flex items-center gap-2 rounded-t-lg px-3 py-2"
        style={{ background: `${meta.color}12` }}
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded text-sm text-white"
          style={{ background: meta.color }}
        >
          {meta.glyph}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">
            {d.label || meta.label}
          </div>
        </div>
      </div>
      <div className="px-3 py-2 text-[11px] text-sub">{subtitle(type, d)}</div>
    </div>
  );
}

// Vertical (top-to-bottom) is the default flow direction: inbound edges land on
// the top handle, outbound edges leave from the bottom handle.
const IN = (
  <Handle type="target" position={Position.Top} style={{ background: "#94a3b8" }} />
);
const OUT = (
  <Handle type="source" position={Position.Bottom} style={{ background: "#94a3b8" }} />
);

export function DatasourceNode(p: NodeProps) {
  return (
    <>
      <Card {...p} type="datasource" />
      {OUT}
    </>
  );
}
export function FunctionNode(p: NodeProps) {
  return (
    <>
      {IN}
      <Card {...p} type="function" />
      {OUT}
    </>
  );
}
export function GateNode(p: NodeProps) {
  return (
    <>
      {IN}
      <Card {...p} type="gate" />
      {OUT}
    </>
  );
}
export function LLMNode(p: NodeProps) {
  return (
    <>
      {IN}
      <Card {...p} type="llm" />
      {OUT}
    </>
  );
}
export function OutputNode(p: NodeProps) {
  return (
    <>
      {IN}
      <Card {...p} type="output" />
    </>
  );
}

export const nodeTypes = {
  datasource: DatasourceNode,
  function: FunctionNode,
  gate: GateNode,
  llm: LLMNode,
  output: OutputNode,
};
