"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { Account, EntitySummary, FamilyMember, Liability } from "@/engine/types";
import { seriesColor } from "@/lib/comparison/series-palette";
import { chartChrome, useThemeName } from "@/lib/chart-colors";
import {
  buildColumns,
  distribute,
  fmt,
  type ColumnKey,
  type ColumnSpec,
  type MatrixRow,
} from "@/lib/comparison/widgets/balance-sheet-shared";

function OwnerMatrix({
  heading,
  rows,
  columns,
  totalsLabel,
  signClass,
}: {
  heading: string;
  rows: MatrixRow[];
  columns: ColumnSpec[];
  totalsLabel: string;
  signClass?: string;
}) {
  const colTotals: Record<ColumnKey, number> = {};
  let grandTotal = 0;
  for (const r of rows) {
    grandTotal += r.value;
    for (const c of columns) {
      colTotals[c.key] = (colTotals[c.key] ?? 0) + (r.dist[c.key] ?? 0);
    }
  }
  return (
    <table className="mb-4 w-full text-xs">
      <thead className="text-ink-3">
        <tr>
          <th className="text-left font-medium uppercase tracking-wide text-ink-2">
            {heading}
          </th>
          {columns.map((c) => (
            <th key={c.key} className="text-right font-normal">
              {c.label}
            </th>
          ))}
          <th className="text-right font-normal">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-hair text-ink">
            <td className="py-1 pr-2">{r.name}</td>
            {columns.map((c) => (
              <td key={c.key} className={`text-right tabular-nums ${signClass ?? ""}`}>
                {fmt(r.dist[c.key] ?? 0)}
              </td>
            ))}
            <td className={`text-right tabular-nums ${signClass ?? ""}`}>{fmt(r.value)}</td>
          </tr>
        ))}
        <tr className="border-t border-hair-2 text-ink">
          <td className="py-1 pr-2 font-semibold">{totalsLabel}</td>
          {columns.map((c) => (
            <td key={c.key} className={`text-right font-semibold tabular-nums ${signClass ?? ""}`}>
              {fmt(colTotals[c.key] ?? 0)}
            </td>
          ))}
          <td className={`text-right font-semibold tabular-nums ${signClass ?? ""}`}>
            {fmt(grandTotal)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function PlanColumn({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const accounts = (plan.tree.accounts ?? []) as Account[];
  const liabilities = (plan.tree.liabilities ?? []) as Liability[];
  const entities = (plan.tree.entities ?? []) as EntitySummary[];
  const familyMembers = (plan.tree.familyMembers ?? []) as FamilyMember[];
  const familyById = new Map<string, FamilyMember>(familyMembers.map((fm) => [fm.id, fm]));

  const assetRows: MatrixRow[] = accounts.map((a) => {
    const value = Number(a.value) || 0;
    return {
      id: a.id,
      name: a.name,
      value,
      dist: distribute(value, a.owners, familyById, a.titlingType),
    };
  });
  const liabilityRows: MatrixRow[] = liabilities.map((l) => {
    const value = Number(l.balance) || 0;
    return {
      id: l.id,
      name: l.name,
      value,
      dist: distribute(value, l.owners, familyById),
    };
  });

  // Compute a unified column set across assets+liabilities so the two tables
  // stack with the same headers.
  const columns = buildColumns(
    [...assetRows, ...liabilityRows].map((r) => r.dist),
    familyMembers,
    entities,
  );

  const totalAssets = assetRows.reduce((s, r) => s + r.value, 0);
  const totalLiabs = liabilityRows.reduce((s, r) => s + r.value, 0);
  const netWorth = totalAssets - totalLiabs;
  const theme = useThemeName();
  const color = seriesColor(index) ?? chartChrome(theme).tick;

  return (
    <div className="rounded-lg border border-hair bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-ink-3">{plan.label}</span>
      </div>
      {assetRows.length === 0 ? (
        <p className="mb-3 text-sm text-ink-3">No accounts.</p>
      ) : (
        <OwnerMatrix
          heading="Assets"
          rows={assetRows}
          columns={columns}
          totalsLabel="Total Assets"
        />
      )}
      {liabilityRows.length > 0 && (
        <OwnerMatrix
          heading="Liabilities"
          rows={liabilityRows}
          columns={columns}
          totalsLabel="Total Liabilities"
          signClass="text-crit"
        />
      )}
      <div className="rounded border border-hair bg-card-2 px-3 py-2 text-sm font-semibold text-ink">
        Net Worth: <span className="tabular-nums">{fmt(netWorth)}</span>
      </div>
    </div>
  );
}

export function BalanceSheetComparisonSection({ plans }: { plans: ComparisonPlan[] }) {
  const cols =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-3";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-ink">Balance Sheet</h2>
      <div className={`grid gap-4 ${cols}`}>
        {plans.map((p, i) => (
          <PlanColumn key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
