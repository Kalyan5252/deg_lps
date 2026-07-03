"use client";

import "@xyflow/react/dist/style.css";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import { useRouter, useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/api";
import { api } from "@/lib/api";
import { nodeTypes, NODE_META } from "@/components/pipeline/nodes";
import ConfigPanel from "@/components/pipeline/ConfigPanel";
import ActivityPanel from "@/components/pipeline/ActivityPanel";

const MENU_ITEMS: { type: string; label: string }[] = [
  { type: "datasource", label: "Add a datasource" },
  { type: "function", label: "Create a function" },
  { type: "gate", label: "Conditional gate" },
  { type: "llm", label: "LLM node" },
  { type: "output", label: "Output / Stream" },
];

function Builder({ pipelineId }: { pipelineId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api
      .pipeline(pipelineId)
      .then((p) => {
        setName(p.name);
        setNodes(p.graph?.nodes || []);
        setEdges(p.graph?.edges || []);
      })
      .catch((e) => setStatus(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  const onConnect = useCallback(
    (params: any) =>
      setEdges((eds) =>
        addEdge(
          { ...params, markerEnd: { type: MarkerType.ArrowClosed } },
          eds
        )
      ),
    [setEdges]
  );

  function graph() {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    };
  }

  function addNode(type: string) {
    const id = `${type}_${Date.now().toString(36)}`;
    const data: any = { label: NODE_META[type].label };
    if (type === "gate") data.conditions = [];
    // Vertical-by-default: stack each new node in a column beneath the
    // lowest existing node (aligned to it), rather than at the cursor.
    const V_GAP = 150; // node height (~90) + breathing room
    setNodes((nds) => {
      let pos: { x: number; y: number };
      if (nds.length === 0) {
        pos = { x: 250, y: 80 };
      } else {
        const bottom = nds.reduce((a, b) =>
          b.position.y > a.position.y ? b : a
        );
        pos = { x: bottom.position.x, y: bottom.position.y + V_GAP };
      }
      return [...nds, { id, type, position: pos, data }];
    });
    setMenu(null);
    setSelectedId(id);
  }

  function patchNode(nodeId: string, patch: any) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
      )
    );
  }

  async function save() {
    setBusy(true);
    setStatus("Saving…");
    try {
      await api.savePipeline(pipelineId, graph());
      setStatus("Saved.");
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setStatus("Running…");
    try {
      const res = await api.runPipeline(pipelineId, graph());
      setActiveRunId(res.run_id);
      setShowActivity(true);
      setStatus("Run started.");
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedId) || null;

  return (
    <div className="flex h-screen flex-col">
      {/* top bar */}
      <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-2">
        <button
          className="text-sub hover:text-ink"
          onClick={() => router.push("/pipelines")}
          title="Back to pipelines"
        >
          ←
        </button>
        <input
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-sm font-semibold outline-none hover:bg-canvas focus:bg-canvas"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {status && <span className="text-xs text-sub">{status}</span>}
        <button className="btn" onClick={save} disabled={busy}>
          Save
        </button>
        <button className="btn btn-primary" onClick={run} disabled={busy}>
          ▶ Run
        </button>
        <button
          className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm ${
            showActivity
              ? "border-accent bg-canvas text-ink"
              : "border-line text-sub hover:bg-canvas hover:text-ink"
          }`}
          onClick={() => setShowActivity((s) => !s)}
          title="Toggle activity log"
        >
          ☰ Activity
        </button>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        <div ref={wrap} className="relative min-w-0 flex-1 bg-[#f7f8fa]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => {
              setMenu(null);
              setSelectedId(null);
            }}
            onPaneContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY });
            }}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={2}
              color="#c2c8d0"
            />
            <Controls />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg border border-dashed border-line bg-white/70 px-6 py-4 text-center text-sm text-sub">
                Right-click the canvas to add a node.
              </div>
            </div>
          )}

          {menu && (
            <div
              className="fixed z-50 w-56 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg"
              style={{ left: menu.x, top: menu.y }}
              onMouseLeave={() => setMenu(null)}
            >
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-sub">
                Add to pipeline
              </div>
              {MENU_ITEMS.map((item) => {
                const meta = NODE_META[item.type];
                return (
                  <button
                    key={item.type}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas"
                    onClick={() => addNode(item.type)}
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded text-xs text-white"
                      style={{ background: meta.color }}
                    >
                      {meta.glyph}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedNode && !showActivity && (
          <ConfigPanel
            pipelineId={pipelineId}
            node={selectedNode}
            edges={edges}
            nodes={nodes}
            onChange={patchNode}
            onClose={() => setSelectedId(null)}
          />
        )}

        {showActivity && (
          <ActivityPanel
            pipelineId={pipelineId}
            activeRunId={activeRunId}
            onClose={() => setShowActivity(false)}
          />
        )}
      </div>
    </div>
  );
}

export default function PipelineBuilderPage() {
  const params = useParams();
  const id = String(params.id);
  return (
    <ReactFlowProvider>
      <Builder pipelineId={id} />
    </ReactFlowProvider>
  );
}
