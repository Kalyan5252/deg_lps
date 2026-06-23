"use client";

export default function Splitter({
  axis,
  onDelta,
}: {
  axis: "x" | "y";
  onDelta: (delta: number) => void;
}) {
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    let last = axis === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const cur = axis === "x" ? ev.clientX : ev.clientY;
      onDelta(cur - last);
      last = cur;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }
  return (
    <div
      onPointerDown={onPointerDown}
      className={
        axis === "x"
          ? "group relative w-px shrink-0 cursor-col-resize bg-line"
          : "group relative h-px shrink-0 cursor-row-resize bg-line"
      }
    >
      <div
        className={
          axis === "x"
            ? "absolute inset-y-0 -left-1 -right-1 z-10 transition-colors group-hover:bg-accent/20"
            : "absolute inset-x-0 -top-1 -bottom-1 z-10 transition-colors group-hover:bg-accent/20"
        }
      />
    </div>
  );
}
