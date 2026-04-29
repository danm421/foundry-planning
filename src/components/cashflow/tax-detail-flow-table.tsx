"use client";

import { useState } from "react";
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
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatCell(n: number): string {
  return n === 0 ? "—" : fmt.format(n);
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
  key: string;
  label: string;
  tooltip?: string;
  value: (y: ProjectionYear) => number;
  formatter?: (n: number) => string;
  /** When true, the column is hidden if all visible years have value 0. */
  zeroSuppress?: boolean;
}

type DrillLevel = "top" | "above_line" | "below_line";

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
    key: "trustTax",
    label: "Trust Tax",
    tooltip:
      "Income tax owed by non-grantor trusts on retained income (1041 compressed brackets, NIIT, and state tax). Sums all non-grantor trusts in the household.",
    value: (y) => {
      if (!y.trustTaxByEntity) return 0;
      let sum = 0;
      for (const breakdown of y.trustTaxByEntity.values()) {
        sum += breakdown.total;
      }
      return sum;
    },
    zeroSuppress: true,
  },
  {
    key: "beneficiaryTax",
    label: "Beneficiary Tax (est)",
    tooltip:
      "Estimated tax owed by out-of-household beneficiaries on DNI distributed to them (rate × DNI). Informational — not paid by the household.",
    value: (y) => y.estimatedBeneficiaryTax ?? 0,
    zeroSuppress: true,
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

function aboveLineColumns(years: ProjectionYear[]): Column[] {
  const cols: Column[] = [
    {
      key: "al_retirement",
      label: "Retirement Contributions",
      tooltip: "401(k) and Traditional IRA employee elective deferrals.",
      value: (y) => y.deductionBreakdown?.aboveLine.retirementContributions ?? 0,
    },
    {
      key: "al_expenses",
      label: "Tagged Expenses",
      tooltip: "Expenses with Tax Treatment set to Above Line.",
      value: (y) => y.deductionBreakdown?.aboveLine.taggedExpenses ?? 0,
    },
    {
      key: "al_manual",
      label: "Manual Entries",
      tooltip: "Manual above-line deduction entries from the Deductions page.",
      value: (y) => y.deductionBreakdown?.aboveLine.manualEntries ?? 0,
    },
    {
      key: "al_total",
      label: "Above-Line Total",
      tooltip: "Sum of all above-line deduction sources.",
      value: (y) => y.deductionBreakdown?.aboveLine.total ?? 0,
    },
  ];
  // Zero-suppress: hide columns where all years are $0, except the total
  return cols.filter((col) =>
    col.key === "al_total" || years.some((y) => col.value(y) !== 0)
  );
}

function belowLineColumns(): Column[] {
  return [
    {
      key: "bl_charitable",
      label: "Charitable",
      tooltip: "Charitable gift deductions from tagged expenses and manual entries.",
      value: (y) => y.deductionBreakdown?.belowLine.charitable ?? 0,
    },
    {
      key: "bl_taxes_paid",
      label: "Taxes Paid",
      tooltip: "State and local taxes (SALT), capped at $40,000 (OBBBA).",
      value: (y) => y.deductionBreakdown?.belowLine.taxesPaid ?? 0,
    },
    {
      key: "bl_interest_paid",
      label: "Interest Paid",
      tooltip: "Mortgage interest from liabilities marked tax-deductible.",
      value: (y) => y.deductionBreakdown?.belowLine.interestPaid ?? 0,
    },
    {
      key: "bl_other",
      label: "Other Itemized",
      tooltip: "Other below-line deductions from tagged expenses and manual entries.",
      value: (y) => y.deductionBreakdown?.belowLine.otherItemized ?? 0,
    },
    {
      key: "bl_itemized_total",
      label: "Itemized Total",
      tooltip: "Sum of all itemized deduction sources.",
      value: (y) => y.deductionBreakdown?.belowLine.itemizedTotal ?? 0,
    },
    {
      key: "bl_standard",
      label: "Standard Deduction",
      tooltip: "IRS standard deduction for filing status, inflation-adjusted.",
      value: (y) => y.deductionBreakdown?.belowLine.standardDeduction ?? 0,
    },
    {
      key: "bl_tax_deductions",
      label: "Tax Deductions",
      tooltip: "The greater of Itemized Total or Standard Deduction.",
      value: (y) => y.deductionBreakdown?.belowLine.taxDeductions ?? 0,
    },
  ];
}

function DrillHeader({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 font-semibold normal-case text-blue-400 hover:text-blue-300 hover:underline"
    >
      {label} <span className="text-xs">▸</span>
    </button>
  );
}

/** Map drill-down column keys to a function that extracts the relevant bySource entries. */
function getSourcesForColumn(
  y: ProjectionYear,
  colKey: string
): Array<{ label: string; amount: number }> | null {
  const bd = y.deductionBreakdown;
  if (!bd) return null;

  // Above-line sources
  if (colKey === "al_retirement" || colKey === "al_total") {
    const entries = Object.values(bd.aboveLine.bySource);
    return entries.length > 0 ? entries : null;
  }

  // Below-line: filter bySource by category
  if (colKey === "bl_charitable") {
    return filterBySource(bd.belowLine.bySource, "charitable", y);
  }
  if (colKey === "bl_interest_paid") {
    return filterBySource(bd.belowLine.bySource, "interest", y);
  }
  if (colKey === "bl_taxes_paid") {
    const sources: Array<{ label: string; amount: number }> = [];
    if (bd.belowLine.stateIncomeTax > 0) {
      sources.push({ label: "State Income Tax", amount: bd.belowLine.stateIncomeTax });
    }
    if (bd.belowLine.propertyTaxes > 0) {
      sources.push({ label: "Property Taxes", amount: bd.belowLine.propertyTaxes });
    }
    const rawTotal = bd.belowLine.stateIncomeTax + bd.belowLine.propertyTaxes;
    if (rawTotal > bd.belowLine.taxesPaid) {
      sources.push({ label: `SALT Cap Applied`, amount: bd.belowLine.taxesPaid - rawTotal });
    }
    return sources.length > 0 ? sources : null;
  }
  if (colKey === "bl_other") {
    const amount = bd.belowLine.otherItemized;
    if (amount <= 0) return null;
    // Filter bySource to entries that are below_line (not charitable)
    const entries = Object.values(bd.belowLine.bySource).filter(
      (s) => !s.label.toLowerCase().includes("charit")
    );
    return entries.length > 0 ? entries : [{ label: "Other itemized", amount }];
  }

  return null;
}

function filterBySource(
  bySource: Record<string, { label: string; amount: number }>,
  _category: string,
  _y: ProjectionYear
): Array<{ label: string; amount: number }> | null {
  // bySource contains all below-line entries; for now return all of them
  const entries = Object.values(bySource);
  return entries.length > 0 ? entries : null;
}

function SourcePopover({ sources, onClose }: {
  sources: Array<{ label: string; amount: number }>;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-ink-3 bg-gray-900 p-2 shadow-xl">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">Sources</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-300"
        >
          ×
        </button>
      </div>
      <ul className="space-y-0.5">
        {sources.map((s, i) => (
          <li key={i} className="flex items-center justify-between text-xs">
            <span className="text-gray-300">{s.label}</span>
            <span className="ml-3 tabular-nums text-gray-200">{fmt.format(s.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Drillable cell — shows a popover with per-source detail on click. */
function DrillCell({
  value,
  formatter,
  sources,
  isBold,
  extraClassName,
}: {
  value: number;
  formatter: (n: number) => string;
  sources: Array<{ label: string; amount: number }> | null;
  isBold: boolean;
  extraClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = sources && sources.length > 0;

  return (
    <td
      className={`relative border-b border-gray-800 bg-gray-900 px-3 py-2 text-right tabular-nums group-hover:bg-gray-800/40 ${
        isBold
          ? "font-semibold"
          : value === 0
            ? "text-gray-600"
            : ""
      } ${hasDetail ? "cursor-pointer hover:text-blue-400" : ""} ${extraClassName ?? ""}`}
      onClick={hasDetail ? () => setOpen(!open) : undefined}
    >
      {formatter(value)}
      {open && sources && (
        <SourcePopover sources={sources} onClose={() => setOpen(false)} />
      )}
    </td>
  );
}

export function TaxDetailFlowTable({
  years,
  onYearClick,
  clientLifeExpectancy,
  spouseLifeExpectancy,
}: TaxDetailFlowTableProps) {
  const [drillLevel, setDrillLevel] = useState<DrillLevel>("top");
  const transitions = detectRegimeTransitions(years);

  // Choose columns based on drill level; zero-suppress flagged columns at top level
  const activeColumns: Column[] = drillLevel === "above_line"
    ? aboveLineColumns(years)
    : drillLevel === "below_line"
      ? belowLineColumns()
      : COLUMNS.filter(
          (col) => !col.zeroSuppress || years.some((y) => col.value(y) !== 0)
        );

  // Bold column keys (totals/winners)
  const boldKeys = new Set(["al_total", "bl_tax_deductions"]);

  // Make Above-Line and Below-Line headers clickable at top level
  const renderHeader = (col: Column) => {
    if (drillLevel === "top" && col.key === "aboveLineDeductions") {
      return (
        <DrillHeader
          label={col.label}
          onClick={() => setDrillLevel("above_line")}
        />
      );
    }
    if (drillLevel === "top" && col.key === "belowLineDeductions") {
      return (
        <DrillHeader
          label={col.label}
          onClick={() => setDrillLevel("below_line")}
        />
      );
    }
    return col.tooltip ? (
      <TaxDetailTooltip label={col.label} text={col.tooltip} />
    ) : (
      col.label
    );
  };

  const drillLabel = drillLevel === "above_line"
    ? "Above-Line Deductions"
    : drillLevel === "below_line"
      ? "Below-Line Deductions"
      : null;

  return (
    <div>
      {drillLabel && (
        <nav className="mb-2 text-xs text-gray-300">
          <button
            type="button"
            onClick={() => setDrillLevel("top")}
            className="text-blue-400 hover:text-blue-300"
          >
            Federal Tax Breakdown
          </button>
          <span className="mx-1">/</span>
          <span className="text-gray-200">{drillLabel}</span>
        </nav>
      )}
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
              {activeColumns.map((col, idx) => {
                const isLast = idx === activeColumns.length - 1;
                return (
                  <th
                    key={col.key}
                    className={`border-b border-gray-800 bg-gray-900 px-3 py-2 text-right font-medium ${boldKeys.has(col.key) ? "text-gray-200" : ""} ${isLast ? "sticky right-0 z-20 border-l" : ""}`}
                  >
                    {renderHeader(col)}
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
                    className={`sticky left-0 z-10 cursor-pointer border-b border-gray-800 bg-gray-900 px-3 py-2 text-left hover:text-blue-400 group-hover:bg-gray-800/40 ${borderClass}`}
                    onClick={() => onYearClick(y)}
                    title={tooltip ?? `View per-source breakdown for ${y.year}`}
                  >
                    {y.year}
                  </td>
                  <td className="sticky left-20 z-10 border-b border-r border-gray-800 bg-gray-900 px-3 py-2 text-left text-gray-300 group-hover:bg-gray-800/40">
                    {formatAge(y.ages, clientLifeExpectancy, spouseLifeExpectancy)}
                  </td>
                  {activeColumns.map((col, idx) => {
                    const v = col.value(y);
                    const formatter = col.formatter ?? formatCell;
                    const isLast = idx === activeColumns.length - 1;
                    const stickyRight = isLast ? "sticky right-0 z-10 border-l" : "";
                    if (drillLevel !== "top") {
                      return (
                        <DrillCell
                          key={col.key}
                          value={v}
                          formatter={formatter}
                          sources={getSourcesForColumn(y, col.key)}
                          isBold={boldKeys.has(col.key)}
                          extraClassName={stickyRight}
                        />
                      );
                    }
                    return (
                      <td
                        key={col.key}
                        className={`border-b border-gray-800 bg-gray-900 px-3 py-2 text-right tabular-nums group-hover:bg-gray-800/40 ${
                          boldKeys.has(col.key)
                            ? "font-semibold"
                            : v === 0
                              ? "text-gray-600"
                              : ""
                        } ${stickyRight}`}
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
    </div>
  );
}
