"use client";

import type { ProjectionYear } from "@/engine";
import { TaxDetailTooltip } from "./tax-detail-tooltip";
import {
  detectRegimeTransitions,
  TRANSITION_BORDER_CLASS,
  TRANSITION_TOOLTIPS,
  pickBorderTransition,
} from "./tax-regime-indicators";
import type { TransitionType } from "./tax-regime-indicators";

interface TaxDetailIncomeTableProps {
  years: ProjectionYear[];
  onYearClick: (year: ProjectionYear) => void;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCell(n: number): string {
  return n === 0 ? "—" : fmt.format(n);
}

function formatAge(ages: { client: number; spouse?: number }): string {
  return ages.spouse != null ? `${ages.client} / ${ages.spouse}` : String(ages.client);
}

interface Column {
  key: string;
  label: string;
  tooltip?: string;
  value: (y: ProjectionYear) => number;
}

const COLUMNS: Column[] = [
  {
    key: "earnedIncome",
    label: "Earned Income",
    tooltip: "Wages and active business income. Subject to FICA and bracket tax.",
    value: (y) => y.taxResult?.income.earnedIncome ?? 0,
  },
  {
    key: "taxableSocialSecurity",
    label: "Taxable SS",
    tooltip:
      "Portion of Social Security benefits subject to federal tax per IRS Pub 915 provisional-income formula.",
    value: (y) => y.taxResult?.income.taxableSocialSecurity ?? 0,
  },
  {
    key: "ordinaryIncome",
    label: "Ordinary Income",
    tooltip:
      "Taxable interest, non-qualified dividends, IRA distributions, RMDs. Taxed at bracket rates.",
    value: (y) => y.taxResult?.income.ordinaryIncome ?? 0,
  },
  {
    key: "dividends",
    label: "Dividends",
    tooltip: "Qualified dividends (preferential LTCG rates).",
    value: (y) => y.taxResult?.income.dividends ?? 0,
  },
  {
    key: "capitalGains",
    label: "LT Cap Gains",
    tooltip: "Long-term capital gains. Taxed at 0/15/20% stacked on ordinary income.",
    value: (y) => y.taxResult?.income.capitalGains ?? 0,
  },
  {
    key: "shortCapitalGains",
    label: "ST Cap Gains",
    tooltip:
      "Short-term capital gains. Taxed as ordinary income but tracked separately for NIIT.",
    value: (y) => y.taxResult?.income.shortCapitalGains ?? 0,
  },
  {
    key: "totalIncome",
    label: "Total Income",
    tooltip: "Sum of all taxable income items. Feeds into the AGI calc.",
    value: (y) => y.taxResult?.income.totalIncome ?? 0,
  },
  {
    key: "nonTaxableIncome",
    label: "Non-Taxable",
    tooltip:
      "Muni bond interest, Roth distributions, non-taxable SS portion. Informational only.",
    value: (y) => y.taxResult?.income.nonTaxableIncome ?? 0,
  },
  {
    key: "grossTotalIncome",
    label: "Gross Total Income",
    tooltip: "Total + Non-Taxable. Denominator for effective tax rate.",
    value: (y) => y.taxResult?.income.grossTotalIncome ?? 0,
  },
];

export function TaxDetailIncomeTable({ years, onYearClick }: TaxDetailIncomeTableProps) {
  const transitions = detectRegimeTransitions(years);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900/60">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-gray-900 text-xs uppercase text-gray-400">
          <tr>
            <th className="sticky left-0 z-10 bg-gray-900 px-3 py-2 text-left">Year</th>
            <th className="px-3 py-2 text-left">Age</th>
            {COLUMNS.map((col) => (
              <th key={col.key} className="px-3 py-2 text-right font-medium">
                {col.tooltip ? (
                  <TaxDetailTooltip label={col.label} text={col.tooltip} />
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800 text-gray-200">
          {years.map((y) => {
            const yearTransitions = transitions[y.year];
            const borderClass = yearTransitions
              ? TRANSITION_BORDER_CLASS[pickBorderTransition(yearTransitions)]
              : "";
            const tooltip = yearTransitions
              ?.map((t: TransitionType) => TRANSITION_TOOLTIPS[t])
              .join("\n");

            return (
              <tr key={y.year} className="hover:bg-gray-800/40">
                <td
                  className={`sticky left-0 z-10 cursor-pointer bg-gray-900/80 px-3 py-2 text-left hover:text-blue-400 ${borderClass}`}
                  onClick={() => onYearClick(y)}
                  title={tooltip ?? `View per-source breakdown for ${y.year}`}
                >
                  {y.year}
                </td>
                <td className="px-3 py-2 text-left text-gray-400">{formatAge(y.ages)}</td>
                {COLUMNS.map((col) => {
                  const v = col.value(y);
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-right tabular-nums ${v === 0 ? "text-gray-600" : ""}`}
                    >
                      {formatCell(v)}
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
