import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  visual?: ReactNode;
  footnote?: ReactNode;
  className?: string;
}

export function KpiCard({ label, value, visual, footnote, className = "" }: KpiCardProps) {
  return (
    <div className={`rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4 flex items-start justify-between gap-3 min-h-[96px] ${className}`}>
      <div className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider text-slate-300">{label}</div>
        <div className="text-3xl font-semibold text-slate-100 tabular-nums leading-tight">
          {value}
        </div>
        {footnote ? (
          <div className="text-xs text-slate-400 mt-1">{footnote}</div>
        ) : null}
      </div>
      {visual ? <div className="shrink-0">{visual}</div> : null}
    </div>
  );
}
