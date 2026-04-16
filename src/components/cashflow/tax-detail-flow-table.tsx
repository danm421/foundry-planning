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

interface TaxDetailFlowTableProps {
  years: ProjectionYear[];
  onYearClick: (year: ProjectionYear) => void;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const pctFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
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
  formatter?: (n: number) => string;
}

const COLUMNS: Column[] = [
  {
    key: "totalIncome",
    label: "Total Income",
    tooltip: "Taxable income before deductions.",
    value: (y) => y.taxResult?.income.totalIncome ?? 0,
  },
  {
    key: "aboveLineDeductions",
    label: "Above-Line Deduct",
    tooltip:
      "HSA, traditional IRA, self-employment tax half, etc. Subtracted to get AGI. (v1: always $0)",
    value: (y) => y.taxResult?.flow.aboveLineDeductions ?? 0,
  },
  {
    key: "adjustedGrossIncome",
    label: "AGI",
    tooltip: "Adjusted Gross Income — also the MAGI used for NIIT.",
    value: (y) => y.taxResult?.flow.adjustedGrossIncome ?? 0,
  },
  {
    key: "belowLineDeductions",
    label: "Below-Line Deduct",
    tooltip: "Standard or itemized deduction (whichever is larger).",
    value: (y) => y.taxResult?.flow.belowLineDeductions ?? 0,
  },
  {
    key: "qbiDeduction",
    label: "QBI",
    tooltip: "Section 199A pass-through deduction (20% of QBI, capped).",
    value: (y) => y.taxResult?.flow.qbiDeduction ?? 0,
  },
  {
    key: "taxableIncome",
    label: "Taxable Income",
    tooltip: "AGI minus below-line minus QBI.",
    value: (y) => y.taxResult?.flow.taxableIncome ?? 0,
  },
  {
    key: "incomeTaxBase",
    label: "Tax Base",
    tooltip:
      "Taxable income minus LTCG/qual div (which get preferential rates). This is the base for bracket tax.",
    value: (y) => y.taxResult?.flow.incomeTaxBase ?? 0,
  },
  {
    key: "regularFederalIncomeTax",
    label: "Regular Fed",
    tooltip: "Progressive bracket tax on Tax Base.",
    value: (y) => y.taxResult?.flow.regularFederalIncomeTax ?? 0,
  },
  {
    key: "capitalGainsTax",
    label: "Cap Gains Tax",
    tooltip:
      "0/15/20% tax on LT cap gains + qualified dividends stacked above ordinary.",
    value: (y) => y.taxResult?.flow.capitalGainsTax ?? 0,
  },
  {
    key: "amtAdditional",
    label: "AMT Add'l",
    tooltip:
      "Additional AMT owed when tentative AMT exceeds regular tax. $0 if regular ≥ AMT.",
    value: (y) => y.taxResult?.flow.amtAdditional ?? 0,
  },
  {
    key: "niit",
    label: "NIIT",
    tooltip:
      "3.8% Net Investment Income Tax on investment income above the MAGI threshold.",
    value: (y) => y.taxResult?.flow.niit ?? 0,
  },
  {
    key: "additionalMedicare",
    label: "Addl Medicare",
    tooltip:
      "0.9% additional Medicare on wages above the threshold ($250k MFJ / $200k single).",
    value: (y) => y.taxResult?.flow.additionalMedicare ?? 0,
  },
  {
    key: "fica",
    label: "FICA",
    tooltip: "Social Security (6.2% up to wage base) + Medicare (1.45%).",
    value: (y) => y.taxResult?.flow.fica ?? 0,
  },
  {
    key: "stateTax",
    label: "State",
    tooltip:
      "Flat state rate × taxable income (MVP simplification — bracket-based state tax deferred).",
    value: (y) => y.taxResult?.flow.stateTax ?? 0,
  },
  {
    key: "totalTax",
    label: "Total Tax",
    tooltip: "All federal + state + FICA combined.",
    value: (y) => y.taxResult?.flow.totalTax ?? 0,
  },
  {
    key: "marginalRate",
    label: "Marginal Rate",
    tooltip:
      "Federal marginal rate at this year's Taxable Income. The 'next dollar of income' rate.",
    value: (y) => y.taxResult?.diag.marginalFederalRate ?? 0,
    formatter: (n) => (n === 0 ? "—" : pctFmt.format(n)),
  },
];

export function TaxDetailFlowTable({ years, onYearClick }: TaxDetailFlowTableProps) {
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
                  const formatter = col.formatter ?? formatCell;
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-right tabular-nums ${v === 0 ? "text-gray-600" : ""}`}
                    >
                      {formatter(v)}
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
