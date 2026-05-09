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

function tax(e?: EstateTaxResult): number | undefined {
  if (!e) return undefined;
  return (e.federalEstateTax ?? 0) + (e.stateEstateTax ?? 0);
}
function admin(e?: EstateTaxResult): number | undefined {
  return e ? (e.estateAdminExpenses ?? 0) : undefined;
}
function subtotal(e?: EstateTaxResult): number | undefined {
  if (!e) return undefined;
  return (tax(e) ?? 0) + (admin(e) ?? 0);
}
function delta(a?: number, b?: number): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  return b - a;
}
function combinedTotal(first?: EstateTaxResult, second?: EstateTaxResult): number | undefined {
  const a = subtotal(first);
  const b = subtotal(second);
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
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

  const rows = [
    { label: "First Death", year: f1?.year ?? f2?.year, kind: "header" as const },
    { label: "Estate tax", a: tax(f1), b: tax(f2), better: "lower" as const },
    { label: "Probate & final expenses", a: admin(f1), b: admin(f2), better: "lower" as const },
    { label: "Subtotal", a: subtotal(f1), b: subtotal(f2), better: "lower" as const, bold: true },
    { label: "Second Death", year: s1?.year ?? s2?.year, kind: "header" as const },
    { label: "Estate tax", a: tax(s1), b: tax(s2), better: "lower" as const },
    { label: "Probate & final expenses", a: admin(s1), b: admin(s2), better: "lower" as const },
    { label: "Subtotal", a: subtotal(s1), b: subtotal(s2), better: "lower" as const, bold: true },
    {
      label: "Combined total",
      a: combinedTotal(f1, s1),
      b: combinedTotal(f2, s2),
      better: "lower" as const,
      bold: true,
    },
  ];

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
        {rows.map((row, i) => {
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
