"use client";

export function PanelGlyph({
  side,
  active,
}: {
  side: "left" | "right";
  active: boolean;
}) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line
        x1={side === "left" ? 6 : 10}
        y1="2.5"
        x2={side === "left" ? 6 : 10}
        y2="13.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      {active && (
        <rect
          x={side === "left" ? 2.5 : 11}
          y="3.5"
          width="2.5"
          height="9"
          rx="1"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

export function PanelToggle({
  side,
  active,
  onClick,
  title,
}: {
  side: "left" | "right";
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
        active ? "bg-canvas text-ink" : "text-sub hover:text-ink"
      }`}
    >
      <PanelGlyph side={side} active={active} />
    </button>
  );
}
