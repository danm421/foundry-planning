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
import { USPS_STATE_NAMES } from "@/lib/usps-states";
import type { StateIncomeTaxResult } from "@/lib/tax/state-income";

interface TaxDetailStateTableProps {
  years: ProjectionYear[];
  onYearClick: (year: ProjectionYear) => void;
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const pctFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

function effRate(state: StateIncomeTaxResult): number {
  if (state.startingIncome <= 0) return 0;
  return state.stateTax / state.startingIncome;
}

interface Column {
  key: string;
  label: string;
  tooltip?: string;
  value: (state: StateIncomeTaxResult) => number;
  formatter?: (n: number) => string;
}

const COLUMNS: Column[] = [
  {
    key: "startingIncome",
    label: "Federal Base",
    tooltip:
      "Starting income from federal calc (AGI, federal taxable, or state GTI depending on the state's incomeBase rule).",
    value: (s) => s.startingIncome,
  },
  {
    key: "addbacks",
    label: "Add-backs",
    tooltip:
      "Items added back to federal base for state purposes (e.g., tax-free interest in states that tax muni bond income).",
    value: (s) => s.addbacks.total,
  },
  {
    key: "ssSubtraction",
    label: "SS Sub",
    tooltip:
      "Social Security subtraction. Many states fully exempt SS; some apply income-based phaseouts.",
    value: (s) => s.subtractions.socialSecurity,
  },
  {
    key: "retireSubtraction",
    label: "Retire Sub",
    tooltip:
      "Retirement-income subtraction (pension/IRA/401(k)/annuity, age- and income-thresholded per state rules).",
    value: (s) => s.subtractions.retirementIncome,
  },
  {
    key: "cgSubtraction",
    label: "CG Sub",
    tooltip:
      "Capital gains subtraction (partial LTCG exclusion in states like AR, MT, ND, WI).",
    value: (s) => s.subtractions.capitalGains,
  },
  {
    key: "stateAGI",
    label: "State AGI",
    tooltip: "Federal base + add-backs − subtractions = state-AGI equivalent.",
    value: (s) => s.stateAGI,
  },
  {
    key: "stdDeduction",
    label: "Std Ded",
    tooltip: "State standard deduction (with age add-ons baked in).",
    value: (s) => s.stdDeduction,
  },
  {
    key: "personalExemption",
    label: "Exemption",
    tooltip: "Personal exemption deduction (when the state uses deduction-style exemptions).",
    value: (s) => s.personalExemptionDeduction,
  },
  {
    key: "stateTaxable",
    label: "State Taxable",
    tooltip: "State taxable income after deductions and exemptions. The base for bracket tax.",
    value: (s) => s.stateTaxableIncome,
  },
  {
    key: "stateTax",
    label: "State Tax",
    tooltip:
      "State income tax after bracket calc, exemption credits, and any state-specific recapture adjustments.",
    value: (s) => s.stateTax,
  },
  {
    key: "effRate",
    label: "Eff Rate",
    tooltip: "State tax ÷ starting income (federal base).",
    value: (s) => effRate(s),
    formatter: (n) => pctFmt.format(n),
  },
];

export function TaxDetailStateTable({
  years,
  onYearClick,
  clientLifeExpectancy,
  spouseLifeExpectancy,
}: TaxDetailStateTableProps) {
  const transitions = detectRegimeTransitions(years);
  const first = years[0]?.taxResult?.state;

  if (!first) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6 text-sm text-gray-400">
        No state-tax detail available for the selected year range.
      </div>
    );
  }

  if (first.hasIncomeTax === false) {
    const stateName = first.state ? USPS_STATE_NAMES[first.state] : "This state";
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6">
        <p className="text-sm font-medium text-gray-100">
          {stateName} does not levy a personal income tax.
        </p>
        <p className="mt-2 text-xs text-gray-400">
          No state-tax breakdown is calculated for years in this residence state. If the residence state
          changes within the projection (e.g., relocation), the breakdown for those years will appear here.
        </p>
      </div>
    );
  }

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
            const state = y.taxResult?.state;
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
                  title={tooltip ?? `View state-tax compute trace for ${y.year}`}
                >
                  {y.year}
                </td>
                <td className="sticky left-20 z-10 border-b border-r border-gray-800 bg-gray-900 px-3 py-2 text-left text-gray-300 group-hover:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff]">
                  {formatAge(y.ages, clientLifeExpectancy, spouseLifeExpectancy)}
                </td>
                {COLUMNS.map((col, idx) => {
                  const v = state ? col.value(state) : 0;
                  const formatter = col.formatter ?? formatCell;
                  const isLast = idx === COLUMNS.length - 1;
                  return (
                    <td
                      key={col.key}
                      className={`border-b border-gray-800 bg-gray-900 px-3 py-2 text-right tabular-nums group-hover:shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_#fff] ${isLast ? "sticky right-0 z-10 border-l" : ""}`}
                    >
                      {state ? formatter(v) : "—"}
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
