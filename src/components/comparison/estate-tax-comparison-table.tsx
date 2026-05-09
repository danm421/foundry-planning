import type { ProjectionResult } from "@/engine/projection";
import type { EstateTaxResult } from "@/engine/types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmt(n: number | undefined): string {
  return n === undefined ? "—" : usd.format(n);
}
function fmtDelta(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n === 0) return "$0";
  const sign = n < 0 ? "−" : "+";
  return `${sign}${usd.format(Math.abs(n))}`;
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

function delta(a?: number, b?: number): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  return b - a;
}

type LineItemRow = {
  kind: "row";
  label: string;
  a: number | undefined;
  b: number | undefined;
  better: "lower" | "higher";
  bold?: boolean;
  hideIfZero?: boolean;
};
type HeaderRow = { kind: "header"; label: string; year?: number };
type Row = HeaderRow | LineItemRow;

function deathRows(label: string, e1?: EstateTaxResult, e2?: EstateTaxResult): Row[] {
  const ird1 = irdTotal(e1);
  const ird2 = irdTotal(e2);
  return [
    { kind: "header", label, year: e1?.year ?? e2?.year },
    {
      kind: "row",
      label: "Federal Estate Tax",
      a: e1 ? e1.federalEstateTax : undefined,
      b: e2 ? e2.federalEstateTax : undefined,
      better: "lower",
    },
    {
      kind: "row",
      label: "State Estate Tax",
      a: e1 ? e1.stateEstateTax : undefined,
      b: e2 ? e2.stateEstateTax : undefined,
      better: "lower",
      hideIfZero: true,
    },
    {
      kind: "row",
      label: "Probate & Final Expenses",
      a: e1 ? e1.estateAdminExpenses : undefined,
      b: e2 ? e2.estateAdminExpenses : undefined,
      better: "lower",
      hideIfZero: true,
    },
    {
      kind: "row",
      label: "Tax on Income with Respect to Decedent (IRD)",
      a: e1 ? ird1 : undefined,
      b: e2 ? ird2 : undefined,
      better: "lower",
      hideIfZero: true,
    },
    {
      kind: "row",
      label: "Subtotal",
      a: deathSubtotal(e1),
      b: deathSubtotal(e2),
      better: "lower",
      bold: true,
    },
  ];
}

interface Props {
  plan1Result: ProjectionResult;
  plan2Result: ProjectionResult;
  plan1Label: string;
  plan2Label: string;
}

export function EstateTaxComparisonTable({ plan1Result, plan2Result, plan1Label, plan2Label }: Props) {
  const f1 = plan1Result.firstDeathEvent;
  const f2 = plan2Result.firstDeathEvent;
  const s1 = plan1Result.secondDeathEvent;
  const s2 = plan2Result.secondDeathEvent;

  const rows: Row[] = [
    ...deathRows("First Death", f1, f2),
    ...deathRows("Second Death", s1, s2),
    {
      kind: "row",
      label: "Combined Total — Taxes & Expenses",
      a: combinedTotal(f1, s1),
      b: combinedTotal(f2, s2),
      better: "lower",
      bold: true,
    },
  ];

  // Drop hide-if-zero rows where both plans render zero or undefined.
  const visible = rows.filter((row) => {
    if (row.kind !== "row" || !row.hideIfZero) return true;
    return (row.a ?? 0) > 0 || (row.b ?? 0) > 0;
  });

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-700 text-slate-300">
          <th className="text-left py-2 font-medium"></th>
          <th className="text-right py-2 font-medium">{plan1Label}</th>
          <th className="text-right py-2 font-medium">{plan2Label}</th>
          <th className="text-right py-2 font-medium">Δ</th>
        </tr>
      </thead>
      <tbody>
        {visible.map((row, i) => {
          if (row.kind === "header") {
            return (
              <tr key={i} className="border-t border-slate-800">
                <td colSpan={4} className="pt-4 pb-1 text-slate-400 text-xs uppercase tracking-wide">
                  {row.label}{row.year !== undefined ? ` (${row.year})` : ""}
                </td>
              </tr>
            );
          }
          const d = delta(row.a, row.b);
          const cellCls = `text-right py-1 ${row.bold ? "font-semibold text-slate-100" : "text-slate-200"}`;
          return (
            <tr key={i}>
              <td className={`py-1 ${row.bold ? "font-semibold text-slate-100" : "text-slate-300"}`}>{row.label}</td>
              <td className={cellCls}>{fmt(row.a)}</td>
              <td className={cellCls}>{fmt(row.b)}</td>
              <td className={`text-right py-1 ${deltaClass(d, row.better)} ${row.bold ? "font-semibold" : ""}`}>{fmtDelta(d)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
