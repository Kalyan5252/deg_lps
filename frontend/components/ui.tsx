"use client";

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line bg-white px-8 py-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-sub">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Difficulty({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Difficulty ${level}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i <= level ? "bg-ink" : "bg-line"
          }`}
        />
      ))}
    </span>
  );
}

export function SkillBar({
  skill,
  confidence,
}: {
  skill: string;
  confidence: number;
}) {
  const color =
    confidence >= 70 ? "bg-ok" : confidence >= 40 ? "bg-warn" : "bg-bad";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium">{skill}</span>
        <span className="tabular-nums text-sub">{confidence}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${confidence}%` }}
        />
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status?: string }) {
  if (status === "solved")
    return (
      <span className="rounded border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
        Solved
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="rounded border border-warn/30 bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">
        In progress
      </span>
    );
  return <span className="tag">Not started</span>;
}
