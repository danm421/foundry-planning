# Tax Engine Drill-Down UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-year Tax Detail modal to the cashflow report that shows Income Breakdown (11 cols) and Tax Flow (18 cols) tables spanning the full projection, opened from the Taxes column header inside the Expenses drill.

**Architecture:** New `src/components/cashflow/` subfolder with five focused components (regime-indicator helper, header tooltip, income table, flow table, modal). `cashflow-report.tsx` gets a minimal edit: convert the Taxes column header into a DrillBtn-style button and mount the new modal. No backend changes — the engine already emits `taxResult` on every `ProjectionYear`.

**Tech Stack:** TypeScript, React 19, Next.js 16, Tailwind CSS, vitest.

**Spec:** [docs/superpowers/specs/2026-04-16-tax-engine-drilldown-design.md](../specs/2026-04-16-tax-engine-drilldown-design.md)

---

## File Structure

```
src/components/cashflow/
  tax-regime-indicators.ts              CREATE (pure helper + types — ~80 lines)
  tax-detail-tooltip.tsx                CREATE (reusable header-tooltip — ~40 lines)
  tax-detail-income-table.tsx           CREATE (Income Breakdown table — ~140 lines)
  tax-detail-flow-table.tsx             CREATE (Tax Flow table — ~180 lines)
  tax-detail-modal.tsx                  CREATE (top-level modal composing the above — ~100 lines)
  __tests__/
    tax-regime-indicators.test.ts       CREATE (the only pure-logic test file — ~120 lines)

src/components/cashflow-report.tsx      MODIFY
  - Add useState for showTaxDetail (1 line)
  - Convert "Taxes" column header (line 770) from plain text to a DrillBtn opening the modal (~5 lines)
  - Import and mount <TaxDetailModal ... /> near the existing TaxDrillModal mount (~8 lines)
```

All five new files are self-contained. The helper and tooltip files have no React-component dependencies on the two table components, so they can land in any order. Tasks are ordered so later tasks only depend on files from earlier tasks.

---

## Task 1: `tax-regime-indicators.ts` + tests

Pure helper that scans the projection timeline and flags regime-transition years (first AMT, first NIIT, first Additional Medicare, retirement/FICA→0, marginal rate jumps ≥5pts). Used by both table components to drive the colored left-border indicator on year rows.

**Files:**
- Create: `src/components/cashflow/tax-regime-indicators.ts`
- Create: `src/components/cashflow/__tests__/tax-regime-indicators.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/cashflow/__tests__/tax-regime-indicators.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectRegimeTransitions } from "../tax-regime-indicators";
import type { ProjectionYear } from "@/engine";

function makeYear(overrides: Partial<{
  year: number;
  amtAdditional: number;
  niit: number;
  additionalMedicare: number;
  fica: number;
  marginalRate: number;
}> = {}): ProjectionYear {
  const {
    year = 2026,
    amtAdditional = 0,
    niit = 0,
    additionalMedicare = 0,
    fica = 0,
    marginalRate = 0.22,
  } = overrides;
  return {
    year,
    ages: { client: 60 },
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    withdrawals: { byAccount: {}, total: 0 },
    expenses: { living: 0, liabilities: 0, other: 0, insurance: 0, taxes: 0, total: 0, bySource: {} },
    savings: { byAccount: {}, total: 0 },
    accountBalances: {},
    netWorth: 0,
    netCashFlow: 0,
    taxResult: {
      income: {
        earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0,
        dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        totalIncome: 0, nonTaxableIncome: 0, grossTotalIncome: 0,
      },
      flow: {
        aboveLineDeductions: 0, adjustedGrossIncome: 0, qbiDeduction: 0,
        belowLineDeductions: 0, taxableIncome: 0, incomeTaxBase: 0,
        regularTaxCalc: 0, amtCredit: 0, taxCredits: 0,
        regularFederalIncomeTax: 0, capitalGainsTax: 0,
        amtAdditional, niit, additionalMedicare, fica,
        stateTax: 0, totalFederalTax: 0, totalTax: 0,
      },
      diag: {
        marginalFederalRate: marginalRate,
        effectiveFederalRate: 0,
        bracketsUsed: {} as never,
        inflationFactor: 1,
      },
    },
  } as unknown as ProjectionYear;
}

describe("detectRegimeTransitions", () => {
  it("returns empty map for empty projection", () => {
    expect(detectRegimeTransitions([])).toEqual({});
  });

  it("returns empty map for single-year projection (no prior year to compare)", () => {
    const result = detectRegimeTransitions([makeYear({ year: 2026, amtAdditional: 1000 })]);
    expect(result).toEqual({});
  });

  it("returns empty map when all years look the same", () => {
    const years = [
      makeYear({ year: 2026, fica: 5000 }),
      makeYear({ year: 2027, fica: 5000 }),
      makeYear({ year: 2028, fica: 5000 }),
    ];
    expect(detectRegimeTransitions(years)).toEqual({});
  });

  it("detects first year AMT adds", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0 }),
      makeYear({ year: 2027, amtAdditional: 500 }),
      makeYear({ year: 2028, amtAdditional: 1200 }),
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("amt_first_year");
    expect(result[2028]).toBeUndefined();
  });

  it("detects first year NIIT applies", () => {
    const years = [
      makeYear({ year: 2026, niit: 0 }),
      makeYear({ year: 2027, niit: 2000 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("niit_first_year");
  });

  it("detects first year additional Medicare applies", () => {
    const years = [
      makeYear({ year: 2026, additionalMedicare: 0 }),
      makeYear({ year: 2027, additionalMedicare: 450 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("addl_medicare_first_year");
  });

  it("detects retirement (FICA drops to 0)", () => {
    const years = [
      makeYear({ year: 2026, fica: 5000 }),
      makeYear({ year: 2027, fica: 0 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("retirement_fica_zero");
  });

  it("detects marginal rate jump of 5+ percentage points (upward only)", () => {
    const years = [
      makeYear({ year: 2026, marginalRate: 0.22 }),
      makeYear({ year: 2027, marginalRate: 0.32 }), // +10pts
      makeYear({ year: 2028, marginalRate: 0.24 }), // -8pts, should not trigger (downward)
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("marginal_rate_jump");
    expect(result[2028]).toBeUndefined();
  });

  it("does not trigger marginal rate jump for <5pt increases", () => {
    const years = [
      makeYear({ year: 2026, marginalRate: 0.22 }),
      makeYear({ year: 2027, marginalRate: 0.24 }), // +2pts
    ];
    expect(detectRegimeTransitions(years)[2027]).toBeUndefined();
  });

  it("records multiple transitions for the same year", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0, niit: 0 }),
      makeYear({ year: 2027, amtAdditional: 1000, niit: 500 }),
    ];
    const transitions = detectRegimeTransitions(years)[2027];
    expect(transitions).toContain("amt_first_year");
    expect(transitions).toContain("niit_first_year");
    expect(transitions).toHaveLength(2);
  });

  it("does not re-trigger amt_first_year on subsequent AMT years", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0 }),
      makeYear({ year: 2027, amtAdditional: 500 }),
      makeYear({ year: 2028, amtAdditional: 800 }),
      makeYear({ year: 2029, amtAdditional: 1200 }),
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("amt_first_year");
    expect(result[2028]).toBeUndefined();
    expect(result[2029]).toBeUndefined();
  });

  it("handles years without taxResult (defensive)", () => {
    const years: ProjectionYear[] = [
      makeYear({ year: 2026, fica: 5000 }),
      { ...makeYear({ year: 2027 }), taxResult: undefined } as ProjectionYear,
      makeYear({ year: 2028, fica: 5000 }),
    ];
    // Should not crash; missing taxResult = no transitions detected
    expect(() => detectRegimeTransitions(years)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/cashflow/__tests__/tax-regime-indicators.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/cashflow/tax-regime-indicators.ts`:

```typescript
import type { ProjectionYear } from "@/engine";

export type TransitionType =
  | "amt_first_year"
  | "niit_first_year"
  | "addl_medicare_first_year"
  | "retirement_fica_zero"
  | "marginal_rate_jump";

/**
 * Scan a projection and flag the year a regime transition first occurs.
 * First year of the projection never produces a transition (no prior to compare).
 * Returns a map keyed by year; years without transitions are absent from the map.
 */
export function detectRegimeTransitions(
  years: ProjectionYear[]
): Record<number, TransitionType[]> {
  const out: Record<number, TransitionType[]> = {};

  for (let i = 1; i < years.length; i++) {
    const curr = years[i];
    const prev = years[i - 1];
    if (!curr.taxResult || !prev.taxResult) continue;

    const transitions: TransitionType[] = [];
    const c = curr.taxResult.flow;
    const p = prev.taxResult.flow;

    if (c.amtAdditional > 0 && p.amtAdditional === 0) {
      transitions.push("amt_first_year");
    }
    if (c.niit > 0 && p.niit === 0) {
      transitions.push("niit_first_year");
    }
    if (c.additionalMedicare > 0 && p.additionalMedicare === 0) {
      transitions.push("addl_medicare_first_year");
    }
    if (c.fica === 0 && p.fica > 0) {
      transitions.push("retirement_fica_zero");
    }

    const currMarginal = curr.taxResult.diag.marginalFederalRate;
    const prevMarginal = prev.taxResult.diag.marginalFederalRate;
    if (currMarginal - prevMarginal >= 0.05) {
      transitions.push("marginal_rate_jump");
    }

    if (transitions.length > 0) {
      out[curr.year] = transitions;
    }
  }

  return out;
}

/**
 * Tooltip copy for each transition type. Used by table components to display
 * a hover explanation on the indicator.
 */
export const TRANSITION_TOOLTIPS: Record<TransitionType, string> = {
  amt_first_year:
    "First year AMT applies. Usually driven by high AGI phasing out your AMT exemption.",
  niit_first_year:
    "First year NIIT applies. MAGI now exceeds the $250k MFJ / $200k single threshold.",
  addl_medicare_first_year:
    "First year additional Medicare applies. Earned income now exceeds the threshold.",
  retirement_fica_zero:
    "First year with no FICA. Earned income has stopped.",
  marginal_rate_jump:
    "Marginal rate jumped at least 5 percentage points — you crossed into a higher bracket this year.",
};

/**
 * Color class for the year-cell left border given a transition type.
 * Green for retirement (positive planning event), amber for tax surcharges
 * kicking in, blue for bracket transitions.
 */
export const TRANSITION_BORDER_CLASS: Record<TransitionType, string> = {
  amt_first_year: "border-l-4 border-amber-500",
  niit_first_year: "border-l-4 border-amber-500",
  addl_medicare_first_year: "border-l-4 border-amber-500",
  retirement_fica_zero: "border-l-4 border-green-500",
  marginal_rate_jump: "border-l-4 border-blue-500",
};

/**
 * When multiple transitions land on the same year, priority ordering for
 * picking the single border color. Amber (surcharge) wins over green/blue
 * since it's usually the more actionable signal for an advisor.
 */
export function pickBorderTransition(transitions: TransitionType[]): TransitionType {
  const priority: TransitionType[] = [
    "amt_first_year",
    "niit_first_year",
    "addl_medicare_first_year",
    "marginal_rate_jump",
    "retirement_fica_zero",
  ];
  for (const t of priority) {
    if (transitions.includes(t)) return t;
  }
  return transitions[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/cashflow/__tests__/tax-regime-indicators.test.ts`

Expected: All 12 tests pass.

- [ ] **Step 5: Run full test suite to verify no regression**

Run: `npm test`

Expected: 196 existing + 12 new = 208 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/components/cashflow/tax-regime-indicators.ts src/components/cashflow/__tests__/tax-regime-indicators.test.ts
git commit -m "feat(tax): add regime-transition helper for drill-down indicators"
```

---

## Task 2: `tax-detail-tooltip.tsx` component

Small reusable component for info icons on column headers. Hover/focus reveals the tooltip text.

**Files:**
- Create: `src/components/cashflow/tax-detail-tooltip.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/cashflow/tax-detail-tooltip.tsx`:

```tsx
"use client";

import { useState } from "react";

interface TaxDetailTooltipProps {
  text: string;
  label: string;
}

/**
 * Column-header tooltip: shows the header label followed by a small info icon
 * that reveals an explanation on hover or focus. Icon is keyboard-accessible
 * via tab + focus.
 */
export function TaxDetailTooltip({ text, label }: TaxDetailTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex items-center gap-1">
      <span>{label}</span>
      <span
        className="relative inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          aria-label={`Explain ${label}`}
          className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-700 text-[10px] text-gray-300 hover:bg-gray-600 focus:bg-gray-600 focus:outline-none"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          ⓘ
        </button>
        {open && (
          <span
            role="tooltip"
            className="absolute top-full left-1/2 z-50 mt-1 w-64 -translate-x-1/2 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-normal text-gray-200 shadow-lg"
          >
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashflow/tax-detail-tooltip.tsx
git commit -m "feat(tax): add reusable column-header tooltip component"
```

---

## Task 3: `tax-detail-income-table.tsx` — Income Breakdown table (11 cols)

Renders the Income Breakdown table. One row per projection year. Sticky-left year column. Horizontal scroll for the wider columns. Regime indicators on the year cell. Click the year cell to open the existing per-year TaxDrillModal.

**Files:**
- Create: `src/components/cashflow/tax-detail-income-table.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/cashflow/tax-detail-income-table.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashflow/tax-detail-income-table.tsx
git commit -m "feat(tax): add Income Breakdown table for tax detail modal"
```

---

## Task 4: `tax-detail-flow-table.tsx` — Tax Flow table (18 cols)

Same shape as the Income table but with the 16 tax-flow columns (plus Year + Age). Includes the marginal-rate diagnostic column.

**Files:**
- Create: `src/components/cashflow/tax-detail-flow-table.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/cashflow/tax-detail-flow-table.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashflow/tax-detail-flow-table.tsx
git commit -m "feat(tax): add Tax Flow table for tax detail modal"
```

---

## Task 5: `tax-detail-modal.tsx` — top-level modal

Composes the two tables with a modal shell: backdrop, close controls, heading. Accepts a click-through callback that opens the existing per-year TaxDrillModal.

**Files:**
- Create: `src/components/cashflow/tax-detail-modal.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/cashflow/tax-detail-modal.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import type { ProjectionYear } from "@/engine";
import { TaxDetailIncomeTable } from "./tax-detail-income-table";
import { TaxDetailFlowTable } from "./tax-detail-flow-table";

interface TaxDetailModalProps {
  years: ProjectionYear[];
  onClose: () => void;
  onYearClick: (year: ProjectionYear) => void;
}

export function TaxDetailModal({ years, onClose, onYearClick }: TaxDetailModalProps) {
  // Close on ESC
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-[90vw] max-w-[1600px] flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Tax Detail — All Years</h2>
            <p className="mt-1 text-xs text-gray-500">
              Hover column headers for explanations. Click a year to see that year&apos;s per-source breakdown.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-auto p-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Income Breakdown</h3>
            <TaxDetailIncomeTable years={years} onYearClick={onYearClick} />
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Tax Calculation Flow</h3>
            <TaxDetailFlowTable years={years} onYearClick={onYearClick} />
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashflow/tax-detail-modal.tsx
git commit -m "feat(tax): add top-level multi-year tax detail modal"
```

---

## Task 6: Wire modal into `cashflow-report.tsx`

Three small edits: add state, convert the Taxes column header into a clickable DrillBtn-style button, and mount the modal.

**Files:**
- Modify: `src/components/cashflow-report.tsx`

- [ ] **Step 1: Read current file to find insertion points**

Before editing, confirm exact line numbers (they may have shifted slightly since the spec was written):

```bash
grep -n "expenses_taxes\|taxDrillModal\|DrillBtn\|setTaxDrillModal" src/components/cashflow-report.tsx | head -20
```

Expected matches around: `useState<TaxDrillModal | null>` (state declaration), the `expenses_taxes` column definition (line ~770), and the `TaxDrillModal` JSX mount (line ~1349).

- [ ] **Step 2: Add import for new modal**

Near the top of `src/components/cashflow-report.tsx` (after the existing imports), add:

```typescript
import { TaxDetailModal } from "@/components/cashflow/tax-detail-modal";
```

- [ ] **Step 3: Add new state for the multi-year modal**

Find the existing `const [taxDrillModal, setTaxDrillModal] = useState<TaxDrillModal | null>(null);` line (near line 206). Add right after it:

```typescript
const [showTaxDetailModal, setShowTaxDetailModal] = useState(false);
```

- [ ] **Step 4: Convert the Taxes column header to a clickable button**

Find the `col("expenses_taxes", "Taxes", ...)` line (around line 770). The current signature passes a string `"Taxes"` as the header label. Change it to use a render function (matching the existing `DrillBtn` pattern from line ~666 for Income):

Replace:
```typescript
col("expenses_taxes", "Taxes", (r) => r.expenses.taxes, (info) => {
```

With:
```typescript
col("expenses_taxes", () => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      setShowTaxDetailModal(true);
    }}
    className="hover:text-blue-400 hover:underline"
    title="View multi-year tax detail"
  >
    Taxes
  </button>
), (r) => r.expenses.taxes, (info) => {
```

NOTE: the exact signature of `col` may expect a string OR a function for the header. If the existing `numCol("income_total", () => <DrillBtn segment="income" label="Income" />, ...)` pattern works (pass a render function as the 2nd arg), this should work. If TypeScript errors appear, match whatever pattern `DrillBtn` uses elsewhere in the file — the type system should accept a render function for the header.

If needed, look at how `DrillBtn` is used in the existing file (grep for `segment="income"` or `DrillBtn`) and adapt. The key behavior: clicking the header (not a cell) opens the modal.

- [ ] **Step 5: Mount the new modal near the existing TaxDrillModal mount**

Find the existing `{taxDrillModal && ( ... )}` block (near line 1349). Add a separate block either above or below it (placement doesn't matter — they're independent):

```tsx
{showTaxDetailModal && (
  <TaxDetailModal
    years={years}
    onClose={() => setShowTaxDetailModal(false)}
    onYearClick={(y) => {
      if (y.taxDetail) {
        setTaxDrillModal({
          year: y.year,
          detail: y.taxDetail,
          totalTaxes: y.expenses.taxes,
        });
      }
    }}
  />
)}
```

Note: `years` is the projection result already in scope in this component (used by the main table). The `onYearClick` callback opens the existing per-year modal using the same shape it already expects.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 7: Run full test suite**

Run: `npm test`

Expected: 208 tests passing (196 existing + 12 from Task 1). No regressions.

- [ ] **Step 8: Commit**

```bash
git add src/components/cashflow-report.tsx
git commit -m "feat(tax): wire multi-year tax detail modal into cashflow report"
```

---

## Task 7: Manual smoke test + any polish

No code changes expected here unless smoke test finds issues. This task is a mandatory human-eye verification step.

**Files:** (none unless bugs found)

- [ ] **Step 1: Start dev server**

```bash
cd /Users/danmueller/Desktop/foundry-planning-tax-drilldown
# Copy .env.local from main if not present
[ -f .env.local ] || cp /Users/danmueller/Desktop/foundry-planning/.env.local .env.local
# Start
nohup npm run dev > /tmp/drilldown-dev.log 2>&1 &
disown
sleep 5
tail -10 /tmp/drilldown-dev.log
```

Expected: "Ready" line in the output, server on http://localhost:3000.

- [ ] **Step 2: Happy-path test — bracket mode client**

Pick a client that has bracket mode enabled (or enable it in Assumptions → Tax Rates).

1. Open the client's Cashflow Report
2. Click the "Expenses" column header (existing drill-btn) → expenses drill opens
3. Confirm the "Taxes" column header inside the drill is now an underlined button on hover
4. Click the "Taxes" column header → **multi-year Tax Detail modal opens**
5. Verify:
   - Modal title reads "Tax Detail — All Years"
   - Income Breakdown section renders with one row per projection year
   - Tax Flow section renders below it
   - Numbers look sensible (e.g., total income ≈ earned + ordinary + dividends + cap gains for each row)
   - $0 values show as dimmed "—"

- [ ] **Step 3: Tooltip verification**

Hover the `ⓘ` icon next to any column header → tooltip appears with the explanation text. Confirm at least 3 different columns show their respective tooltips.

Keyboard: Tab to an icon, confirm focus ring shows, tooltip visible on focus.

- [ ] **Step 4: Click-through verification**

Click any year cell in either table → existing per-year `TaxDrillModal` opens for that year, showing the per-source breakdown (earned/ordinary/dividends/etc. expandable).

Close the per-year modal → the multi-year modal stays visible underneath (both open simultaneously is OK).

Close the multi-year modal (× button or ESC or backdrop click) → returns to cashflow report cleanly.

- [ ] **Step 5: Regime-transition indicators**

Find a year where a regime transition should apply. Easiest way: open a high-income client plan where NIIT or AMT kicks in at some point. Look for the colored left border on that year's Year cell.

If no such year exists in the test plan:
1. Create a synthetic case in Assumptions: increase client income dramatically so AGI crosses $250k MFJ
2. Re-open the modal — the first year AGI crosses threshold should have an amber border
3. Hover the year cell → tooltip explains "First year NIIT applies..."

If no indicators show up anywhere across multiple test plans, double-check the `detectRegimeTransitions` logic.

- [ ] **Step 6: Flat mode verification**

1. In Assumptions → Tax Rates, toggle to "Flat rate"
2. Save
3. Reload Cashflow Report
4. Open the Tax Detail modal again
5. Expected: most Tax Flow columns show "—" (zero), because flat mode doesn't compute AMT/NIIT/QBI/FICA. Total Tax column still populated (flat federal + state).
6. Total Income / Gross Total Income columns also show 0 in flat mode (the flat shim doesn't decompose income) — this is expected, documented in the spec.

- [ ] **Step 7: Edge cases**

1. **Spouse-absent client**: open a single-filer client and verify the Age column shows "64" not "64 / undefined" or similar.
2. **Short projection**: pick a client with a 1-2 year projection (or temporarily adjust plan end). Modal should render without crashes.
3. **No indicators**: a typical low-income retiree probably has no transitions. Modal should render with no colored borders and no crashes.

- [ ] **Step 8: Run full test suite one more time**

```bash
npm test
```

Expected: 208 tests passing.

- [ ] **Step 9: Stop dev server, commit any polish changes**

```bash
pgrep -f "next dev" | xargs -r kill
```

If smoke test surfaced polish changes (spacing, copy edits, color tweaks), apply them and commit:

```bash
git add <changed files>
git commit -m "polish(tax): <describe the tweak>"
```

If no issues found, no commit needed for this task — just note in the final report that smoke test passed.

---

## Done

The multi-year Tax Detail modal is wired end-to-end:
- Opens from the Taxes column header inside the Expenses drill
- Shows two tables (Income Breakdown + Tax Flow) across all projection years
- Column-header tooltips explain each metric
- Year cells click through to the existing per-year TaxDrillModal
- Regime-transition indicators flag first year AMT, NIIT, Additional Medicare, retirement, and bracket jumps
- Marginal federal rate shown as diagnostic column
- Handles flat mode gracefully (shows zeros instead of missing columns)
