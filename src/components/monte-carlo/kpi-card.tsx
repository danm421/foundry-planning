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
    <div className={`rounded-lg bg-card ring-1 ring-hair p-4 flex items-stretch justify-between gap-3 min-h-[96px] ${className}`}>
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wider text-ink-2">{label}</div>
        <div className="mt-auto text-3xl font-semibold text-ink tabular-nums leading-tight">
          {value}
        </div>
        {footnote ? (
          <div className="text-xs text-ink-3 mt-1">{footnote}</div>
        ) : null}
      </div>
      {visual ? <div className="shrink-0">{visual}</div> : null}
    </div>
  );
}
