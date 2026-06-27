"use client";

export default function RunningState({
  label = "Running query…",
}: {
  label?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-sub">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.2s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.1s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-accent" />
      </div>
      <span>{label}</span>
    </div>
  );
}
