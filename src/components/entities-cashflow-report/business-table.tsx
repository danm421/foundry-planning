import type { BusinessCashFlowRow } from "@/engine/types";
import { BUSINESS_COLUMNS, formatCurrency, formatAges } from "./tokens";

export default function BusinessTable({ rows, currentYear }: { rows: BusinessCashFlowRow[]; currentYear: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-gray-400">
          <tr className="border-b border-gray-800">
            {BUSINESS_COLUMNS.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-normal first:text-left whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-gray-100">
          {rows.map((r) => {
            const isCurrent = r.year === currentYear;
            return (
              <tr key={r.year} className={`border-b border-gray-800/60 last:border-b-0 ${isCurrent ? "bg-gray-800/40 font-semibold" : ""}`}>
                <td className="px-3 py-1.5 text-left">{r.year}</td>
                <td className="px-3 py-1.5 text-left">{formatAges(r.ages)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.beginningTotalValue)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.beginningBasis)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.growth)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.income)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.expenses)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.annualDistribution)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.retainedEarnings)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.endingTotalValue)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.endingBasis)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
