import type { ProjectionResult } from "@/engine/projection";
import type { EstateTaxResult } from "@/engine/types";
import { seriesColor } from "@/lib/comparison/series-palette";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
function fmt(n: number | undefined): string {
  return n === undefined ? "—" : usd.format(n);
}
function fmtDelta(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n === 0) return "$0";
  return `${n < 0 ? "−" : "+"}${usd.format(Math.abs(n))}`;
}
function deltaClass(n: number | undefined, betterDirection: "lower" | "higher"): string {
  if (n === undefined || n === 0) return "text-slate-400";
  const isBetter = betterDirection === "lower" ? n < 0 : n > 0;
  return isBetter ? "text-emerald-400" : "text-rose-400";
}

// IRD = sum of drainAttributions where drainKind === "ird_tax". Mirrors the
// logic in `estate-tax-report-view.tsx` and `transfer-report.ts`.
function irdTotal(e?: EstateTaxResult): number {
  if (!e) return 0;
  return (e.drainAttributions ?? [])
    .filter((a) => a.drainKind === "ird_tax")
    .reduce((s, a) => s + a.amount, 0);
}
function deathSubtotal(e?: EstateTaxResult): number | undefined {
  if (!e) return undefined;
  return (e.totalTaxesAndExpenses ?? 0) + irdTotal(e);
}
function combinedTotal(first?: EstateTaxResult, second?: EstateTaxResult): number | undefined {
  const a = deathSubtotal(first);
  const b = deathSubtotal(second);
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

type Row =
  | { kind: "header"; label: string; year?: number }
  | {
      kind: "row";
      label: string;
      values: (number | undefined)[]; // length === plans.length
      better: "lower" | "higher";
      bold?: boolean;
      hideIfZero?: boolean;
    };

export interface PlanEstateTax {
  label: string;
  result: ProjectionResult;
}
interface Props {
  plans: PlanEstateTax[];
}

export function EstateTaxComparisonTable({ plans }: Props) {
  const firsts = plans.map((p) => p.result.firstDeathEvent);
  const seconds = plans.map((p) => p.result.secondDeathEvent);

  function deathRows(label: string, events: (EstateTaxResult | undefined)[]): Row[] {
    return [
      { kind: "header", label, year: events.find((e) => e?.year !== undefined)?.year },
      {
        kind: "row",
        label: "Federal Estate Tax",
        values: events.map((e) => (e ? e.federalEstateTax : undefined)),
        better: "lower",
      },
      {
        kind: "row",
        label: "State Estate Tax",
        values: events.map((e) => (e ? e.stateEstateTax : undefined)),
        better: "lower",
        hideIfZero: true,
      },
      {
        kind: "row",
        label: "Probate & Final Expenses",
        values: events.map((e) => (e ? e.estateAdminExpenses : undefined)),
        better: "lower",
        hideIfZero: true,
      },
      {
        kind: "row",
        label: "Tax on Income with Respect to Decedent (IRD)",
        values: events.map((e) => (e ? irdTotal(e) : undefined)),
        better: "lower",
        hideIfZero: true,
      },
      {
        kind: "row",
        label: "Subtotal",
        values: events.map((e) => deathSubtotal(e)),
        better: "lower",
        bold: true,
      },
    ];
  }

  const rows: Row[] = [
    ...deathRows("First Death", firsts),
    ...deathRows("Second Death", seconds),
    {
      kind: "row",
      label: "Combined Total — Taxes & Expenses",
      values: plans.map((_p, i) => combinedTotal(firsts[i], seconds[i])),
      better: "lower",
      bold: true,
    },
  ];

  // Drop hide-if-zero rows where ALL plans render zero/undefined.
  const visible = rows.filter((row) => {
    if (row.kind !== "row" || !row.hideIfZero) return true;
    return row.values.some((v) => (v ?? 0) > 0);
  });

  const colCount = 1 + plans.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-slate-700 text-slate-300">
            <th role="columnheader" className="text-left py-2 font-medium" />
            {plans.map((p, i) => (
              <th
                key={i}
                role="columnheader"
                className="text-right py-2 font-medium"
              >
                <div className="flex items-center justify-end gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: seriesColor(i) }}
                    aria-hidden
                  />
                  {p.label}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, ri) => {
            if (row.kind === "header") {
              return (
                <tr key={ri} className="border-t border-slate-800">
                  <td
                    colSpan={colCount}
                    className="pt-4 pb-1 text-slate-400 text-xs uppercase tracking-wide"
                  >
                    {row.label}
                    {row.year !== undefined ? ` (${row.year})` : ""}
                  </td>
                </tr>
              );
            }
            const baseline = row.values[0];
            return (
              <tr key={ri}>
                <td
                  className={`py-1 ${
                    row.bold ? "font-semibold text-slate-100" : "text-slate-300"
                  }`}
                >
                  {row.label}
                </td>
                {row.values.map((v, i) => {
                  const cellCls = `text-right py-1 ${
                    row.bold ? "font-semibold text-slate-100" : "text-slate-200"
                  }`;
                  if (i === 0) {
                    return (
                      <td key={i} className={cellCls}>
                        {fmt(v)}
                      </td>
                    );
                  }
                  const d =
                    baseline === undefined || v === undefined ? undefined : v - baseline;
                  return (
                    <td key={i} className={cellCls}>
                      <div>{fmt(v)}</div>
                      <div className={`text-xs ${deltaClass(d, row.better)}`}>
                        {fmtDelta(d)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
