import type { ReactNode } from "react";

export function SummaryLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 px-1 py-2">
      <header>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="text-[13px] text-ink-3">{subtitle}</p> : null}
      </header>
      {children}
    </div>
  );
}

export function SummarySection({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {heading ? <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">{heading}</h3> : null}
      {children}
    </section>
  );
}

export function SummaryKpiRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

export function SummaryKpiCard({ label, value, delta }: { label: string; value: ReactNode; delta?: string }) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col rounded-lg border border-hair bg-card-2 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</div>
      {/* mt-auto pins the value block to the bottom so values line up across cards with 1- vs 2-line labels */}
      <div className="mt-auto">
        <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
        {delta ? <div className="text-[11px] text-ink-3">{delta}</div> : null}
      </div>
    </div>
  );
}

export interface SummaryTableColumn { key: string; header: string; align?: "left" | "right" }
export function SummaryTable({ columns, rows }: { columns: SummaryTableColumn[]; rows: Record<string, ReactNode>[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-hair text-ink-3">
          {columns.map((c) => (
            <th key={c.key} className={`whitespace-nowrap px-2 py-1.5 font-medium first:pl-0 last:pr-0 ${c.align === "right" ? "text-right" : "text-left"}`}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-hair">
        {rows.map((r, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c.key} className={`whitespace-nowrap px-2 py-1.5 text-ink first:pl-0 last:pr-0 ${c.align === "right" ? "text-right tabular-nums" : "text-left"}`}>{r[c.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SummaryNarrative({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5 rounded-lg border border-hair bg-card-2 px-4 py-3 text-[13px] text-ink-3">
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </ul>
  );
}

export function SummarySkeleton({ label }: { label: string }) {
  return <div className="flex h-full min-h-[200px] items-center justify-center text-[13px] text-ink-3">{label}</div>;
}

export function SummaryEmpty({ message }: { message: string }) {
  return <div className="flex h-full min-h-[200px] items-center justify-center text-[13px] text-ink-3">{message}</div>;
}
