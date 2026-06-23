// src/components/portal/investment-allocation-bars.tsx
import type { ReactElement } from "react";

export function InvestmentAllocationBars({
  allocations,
}: { allocations: { name: string; weight: number }[] }): ReactElement {
  const sum = allocations.reduce((s, a) => s + a.weight, 0);
  const residual = 1 - sum;
  const rows = [...allocations];
  if (residual > 0.005) rows.push({ name: "Unclassified", weight: residual });
  const max = Math.max(...rows.map((r) => r.weight), 0.0001);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-ink-2">Allocation</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[120px_1fr_56px] items-center gap-3">
            <span className="truncate text-[13px] text-ink-2">{r.name}</span>
            <span className="h-2 rounded-full bg-card-2">
              <span className="block h-2 rounded-full bg-accent" style={{ width: `${(r.weight / max) * 100}%` }} />
            </span>
            <span className="text-right text-[13px] font-medium text-ink">{(r.weight * 100).toFixed(2)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
