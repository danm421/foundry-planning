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
import type { IncomeColumnKey } from "@/lib/tax/cell-drill/types";

interface TaxDetailIncomeTableProps {
  years: ProjectionYear[];
  onYearClick: (year: ProjectionYear) => void;
  onCellClick: (year: ProjectionYear, columnKey: IncomeColumnKey) => void;
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatCell(n: number): string {
  return fmt.format(n);
}

function formatAge(
  ages: { client: number; spouse?: number },
  clientLE?: number,
  spouseLE?: number | null,
): string {
  const cLE = clientLE ?? 95;
  const sLE = spouseLE ?? 95;
  const clientStr = ages.client > cLE ? "—" : String(ages.client);
  if (ages.spouse == null) return clientStr;
  const spouseStr = ages.spouse > sLE ? "—" : String(ages.spouse);
  return `${clientStr} / ${spouseStr}`;
}

interface Column {
  key: IncomeColumnKey;
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

export function TaxDetailIncomeTable({
  years,
  onYearClick,
  onCellClick,
  clientLifeExpectancy,
  spouseLifeExpectancy,
}: TaxDetailIncomeTableProps) {
  const transitions = detectRegimeTransitions(years);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-900/60">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="bg-gray-900 text-xs uppercase text-gray-300">
          <tr>
            <th className="sticky left-0 z-20 w-20 min-w-[5rem] border-b border-gray-800 bg-gray-900 px-3 py-2 text-left">
              Year
            </th>
            <th className="sticky left-20 z-20 w-24 min-w-[6rem] border-b border-r border-gray-800 bg-gray-900 px-3 py-2 text-left">
              Age
            </th>
            {COLUMNS.map((col, idx) => {
              const isLast = idx === COLUMNS.length - 1;
              return (
                <th
                  key={col.key}
                  className={`border-b border-gray-800 bg-gray-900 px-3 py-2 text-right font-medium ${isLast ? "sticky right-0 z-20 border-l" : ""}`}
                >
                  {col.tooltip ? (
                    <TaxDetailTooltip label={col.label} text={col.tooltip} />
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="text-gray-200">
          {years.map((y) => {
            const yearTransitions = transitions[y.year];
            const borderClass = yearTransitions
              ? TRANSITION_BORDER_CLASS[pickBorderTransition(yearTransitions)]
              : "";
            const tooltip = yearTransitions
              ?.map((t: TransitionType) => TRANSITION_TOOLTIPS[t])
              .join("\n");

            return (
              <tr key={y.year} className="group">
                <td
                  className={`sticky left-0 z-10 cursor-pointer border-b border-gray-800 bg-gray-900 px-3 py-2 text-left hover:text-accent group-hover:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff] ${borderClass}`}
                  onClick={() => onYearClick(y)}
                  title={tooltip ?? `View per-source breakdown for ${y.year}`}
                >
                  {y.year}
                </td>
                <td className="sticky left-20 z-10 border-b border-r border-gray-800 bg-gray-900 px-3 py-2 text-left text-gray-300 group-hover:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff]">
                  {formatAge(y.ages, clientLifeExpectancy, spouseLifeExpectancy)}
                </td>
                {COLUMNS.map((col, idx) => {
                  const v = col.value(y);
                  const isLast = idx === COLUMNS.length - 1;
                  return (
                    <td
                      key={col.key}
                      className={`border-b border-gray-800 bg-gray-900 px-0 py-0 text-right tabular-nums group-hover:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff] ${isLast ? "sticky right-0 z-10 border-l" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => onCellClick(y, col.key)}
                        aria-label={`${col.label} value ${formatCell(v).replace(/^\$/, "")}`}
                        className="block w-full cursor-pointer px-3 py-2 text-right hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {formatCell(v)}
                      </button>
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
