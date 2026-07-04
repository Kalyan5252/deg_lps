"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
  useReactFlow,
} from "@xyflow/react";
import { useState } from "react";

/**
 * An edge that reveals a small “×” delete button when you hover the edge (or
 * when it's selected). Clicking the × removes the connection.
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const show = hovered || selected;

  function remove(e: React.MouseEvent) {
    e.stopPropagation();
    setEdges((eds) => eds.filter((edge) => edge.id !== id));
  }

  return (
    <>
      {/* wide, invisible hit area so hovering anywhere near the edge works */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={remove}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: show ? "#ef4444" : (style?.stroke as string) || "#b1b7c3",
          strokeWidth: show ? 2 : 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={remove}
          title="Remove connection"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            borderRadius: 9999,
            border: "1px solid #ef4444",
            background: "#fff",
            color: "#ef4444",
            fontSize: 13,
            lineHeight: 1,
            cursor: "pointer",
            opacity: show ? 1 : 0,
            transition: "opacity 120ms ease",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          }}
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { deletable: DeletableEdge };
