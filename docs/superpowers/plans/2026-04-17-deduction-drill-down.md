# Deduction Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drill-down columns to the Tax Detail modal's Federal Tax Breakdown tab for Above-Line and Below-Line deductions, showing per-source breakdowns with zero-suppression and breadcrumb navigation.

**Architecture:** A `DeductionBreakdown` object is assembled in `projection.ts` from the existing 6 contribution sources (no changes to tax helpers). The `TaxDetailFlowTable` component gets a `drillLevel` state that swaps the column set when the user clicks Above-Line or Below-Line headers.

**Tech Stack:** TypeScript, React 19, vitest.

**Spec:** [docs/superpowers/specs/2026-04-17-deduction-drill-down-design.md](../specs/2026-04-17-deduction-drill-down-design.md)

---

## File Structure

```
src/engine/types.ts                                     MODIFY (~20 lines)
  - Add DeductionBreakdown interface
  - Add deductionBreakdown? to ProjectionYear

src/engine/projection.ts                                MODIFY (~60 lines)
  - Import saltCap
  - Assemble deductionBreakdown from 6 contribution sources
  - Attach to ProjectionYear output

src/engine/__tests__/projection.test.ts                 MODIFY (+3 tests)

src/components/cashflow/tax-detail-flow-table.tsx        MODIFY (~150 lines)
  - Add drillLevel state
  - Clickable headers for Above-Line and Below-Line
  - Above-line expanded column set
  - Below-line expanded column set
  - Zero-suppression logic
  - Breadcrumb navigation
```

---

## Task 1: Add DeductionBreakdown type to engine types

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Add DeductionBreakdown interface**

At the end of the `// ── Output Types ──` section (after `AccountLedgerEntry`, around line 264), add:

```typescript
export interface DeductionBreakdown {
  aboveLine: {
    retirementContributions: number;
    taggedExpenses: number;
    manualEntries: number;
    total: number;
    bySource: Record<string, { label: string; amount: number }>;
  };
  belowLine: {
    charitable: number;
    taxesPaid: number;
    interestPaid: number;
    otherItemized: number;
    itemizedTotal: number;
    standardDeduction: number;
    taxDeductions: number;
    bySource: Record<string, { label: string; amount: number }>;
  };
}
```

- [ ] **Step 2: Add deductionBreakdown to ProjectionYear**

In the `ProjectionYear` interface, after `taxResult?: TaxResult;` (around line 180), add:

```typescript
  deductionBreakdown?: DeductionBreakdown;
```

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(deductions): add DeductionBreakdown type to engine output"
```

---

## Task 2: Assemble deductionBreakdown in projection.ts

**Files:**
- Modify: `src/engine/projection.ts`

- [ ] **Step 1: Add saltCap to imports**

Update the import from `derive-deductions` (around line 18-26) to include `saltCap`:

```typescript
import {
  deriveAboveLineFromSavings,
  deriveAboveLineFromExpenses,
  deriveItemizedFromExpenses,
  deriveMortgageInterestFromLiabilities,
  derivePropertyTaxFromAccounts,
  sumItemizedFromEntries,
  aggregateDeductions,
  saltCap,
} from "../lib/tax/derive-deductions";
```

- [ ] **Step 2: Assemble the breakdown after contributions are computed**

After the existing `aggregateDeductions` call and before the `calculateTaxYearBracket` call (around line 494-497), add the breakdown assembly. Replace this block:

```typescript
      const agg = aggregateDeductions(year, ...contributions);
      aboveLineDeductions = agg.aboveLine;
      itemizedDeductions = agg.itemized;
    }
```

With:

```typescript
      const agg = aggregateDeductions(year, ...contributions);
      aboveLineDeductions = agg.aboveLine;
      itemizedDeductions = agg.itemized;

      // Assemble per-source breakdown for drill-down UI.
      // contributions[0] = savings above-line
      // contributions[1] = expenses above-line
      // contributions[2] = expenses itemized (charitable/below_line → itemized, property_tax → saltPool)
      // contributions[3] = mortgage interest
      // contributions[4] = property tax from accounts
      // contributions[5] = manual client_deductions
      const retirementContributions = contributions[0].aboveLine;
      const expenseAboveLine = contributions[1].aboveLine;
      const manualAboveLine = contributions[5].aboveLine;

      // Below-line: need per-category split. The contribution objects lump
      // charitable + below_line into a single `itemized` bucket. Compute
      // the per-category amounts directly from source data.
      let charitable = 0;
      let otherItemized = 0;
      const belowLineBySource: Record<string, { label: string; amount: number }> = {};

      for (const exp of allExpenses) {
        if (!exp.deductionType || exp.deductionType === "above_line" || exp.deductionType === "property_tax") continue;
        if (year < exp.startYear || year > exp.endYear) continue;
        const inflateFrom = exp.inflationStartYear ?? exp.startYear;
        const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, year - inflateFrom);
        if (exp.deductionType === "charitable") {
          charitable += amount;
          belowLineBySource[exp.id] = { label: `Expense: ${exp.name}`, amount };
        } else {
          otherItemized += amount;
          belowLineBySource[exp.id] = { label: `Expense: ${exp.name}`, amount };
        }
      }

      for (const row of data.deductions ?? []) {
        if (year < row.startYear || year > row.endYear) continue;
        const yearsSinceStart = year - row.startYear;
        const inflated = row.annualAmount * Math.pow(1 + row.growthRate, yearsSinceStart);
        if (row.type === "charitable") {
          charitable += inflated;
        } else if (row.type === "below_line") {
          otherItemized += inflated;
        }
        // above_line and property_tax handled by their own buckets
      }

      const interestPaid = contributions[3].itemized;
      const rawSalt = contributions[2].saltPool + contributions[4].saltPool + contributions[5].saltPool;
      const taxesPaid = Math.min(rawSalt, saltCap(year));
      const itemizedTotal = charitable + taxesPaid + interestPaid + otherItemized;

      // Build above-line bySource
      const aboveLineBySource: Record<string, { label: string; amount: number }> = {};
      // Add individual savings rule sources
      for (const rule of data.savingsRules) {
        if (year < rule.startYear || year > rule.endYear) continue;
        const acct = data.accounts.find((a) => a.id === rule.accountId);
        if (!acct) continue;
        const subType = acct.subType ?? "";
        if (subType !== "traditional_ira" && subType !== "401k") continue;
        if (acct.ownerEntityId != null && !isGrantorEntity(acct.ownerEntityId)) continue;
        aboveLineBySource[rule.id] = { label: acct.name, amount: rule.annualAmount };
      }

      deductionBreakdownResult = {
        aboveLine: {
          retirementContributions,
          taggedExpenses: expenseAboveLine,
          manualEntries: manualAboveLine,
          total: aboveLineDeductions,
          bySource: aboveLineBySource,
        },
        belowLine: {
          charitable,
          taxesPaid,
          interestPaid,
          otherItemized,
          itemizedTotal,
          standardDeduction: resolved!.params.stdDeduction[filingStatus],
          taxDeductions: Math.max(itemizedTotal, resolved!.params.stdDeduction[filingStatus]),
          bySource: belowLineBySource,
        },
      };
    }
```

- [ ] **Step 3: Declare the variable before the if block**

Before the `if (useBracket)` block (around line 436-438), add:

```typescript
    let deductionBreakdownResult: import("./types").DeductionBreakdown | undefined;
```

- [ ] **Step 4: Attach to ProjectionYear output**

In the `years.push({...})` block (around line 887-901), add `deductionBreakdown` after `taxResult`:

```typescript
    years.push({
      year,
      ages,
      income,
      taxDetail,
      taxResult,
      deductionBreakdown: deductionBreakdownResult,
      withdrawals,
      expenses,
      savings,
      totalIncome,
      totalExpenses,
      netCashFlow,
      portfolioAssets,
      accountLedgers,
    });
```

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run src/engine/__tests__/projection.test.ts`

Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/projection.ts
git commit -m "feat(deductions): assemble deductionBreakdown in projection loop"
```

---

## Task 3: Add integration tests for deductionBreakdown

**Files:**
- Modify: `src/engine/__tests__/projection.test.ts`

- [ ] **Step 1: Add 3 tests**

Add inside `describe("projection — bracket/flat tax routing")`:

```typescript
  it("populates deductionBreakdown.aboveLine with retirement contributions", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const bd = years[0].deductionBreakdown;
    expect(bd).toBeDefined();
    expect(bd!.aboveLine.retirementContributions).toBe(23500); // 401k rule
    expect(bd!.aboveLine.total).toBe(bd!.aboveLine.retirementContributions + bd!.aboveLine.taggedExpenses + bd!.aboveLine.manualEntries);
  });

  it("populates deductionBreakdown.belowLine with taxesPaid and interestPaid", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const bd = years[0].deductionBreakdown;
    expect(bd).toBeDefined();
    // Fixture has real estate account with $12k property tax and deductible mortgage
    expect(bd!.belowLine.taxesPaid).toBeGreaterThan(0);
    expect(bd!.belowLine.interestPaid).toBeGreaterThan(0);
    expect(bd!.belowLine.itemizedTotal).toBe(
      bd!.belowLine.charitable + bd!.belowLine.taxesPaid + bd!.belowLine.interestPaid + bd!.belowLine.otherItemized
    );
  });

  it("belowLine.taxDeductions is max of itemizedTotal and standardDeduction", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const bd = years[0].deductionBreakdown;
    expect(bd).toBeDefined();
    expect(bd!.belowLine.taxDeductions).toBe(
      Math.max(bd!.belowLine.itemizedTotal, bd!.belowLine.standardDeduction)
    );
    expect(bd!.belowLine.standardDeduction).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/engine/__tests__/projection.test.ts`

Expected: All pass including the 3 new tests.

- [ ] **Step 3: Commit**

```bash
git add src/engine/__tests__/projection.test.ts
git commit -m "test(deductions): add integration tests for deductionBreakdown"
```

---

## Task 4: Add drill-down to TaxDetailFlowTable

**Files:**
- Modify: `src/components/cashflow/tax-detail-flow-table.tsx`

This is the main UI task. The component needs a `drillLevel` state, clickable headers, expanded column sets, zero-suppression, and breadcrumb.

- [ ] **Step 1: Add drillLevel state and types**

At the top of the file, after the existing imports (line ~12), add a type:

```typescript
type DrillLevel = "top" | "above_line" | "below_line";
```

Inside the `TaxDetailFlowTable` function (line ~154), add state:

```typescript
  const [drillLevel, setDrillLevel] = useState<DrillLevel>("top");
```

Add `useState` to the React import. Currently there are no React imports (it's a server-ish component), so add at the top:

```typescript
import { useState } from "react";
```

- [ ] **Step 2: Define expanded column sets**

After the existing `COLUMNS` array (line ~152), add helper functions that return columns for the expanded views:

```typescript
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
  // Zero-suppress: remove columns where all years have $0, except the total
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
```

- [ ] **Step 3: Add DrillHeader component**

After the helper functions, add a clickable header component:

```typescript
function DrillHeader({ label, tooltip, onClick }: { label: string; tooltip: string; onClick: () => void }) {
  return (
    <TaxDetailTooltip
      label={
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300"
        >
          {label} <span className="text-xs">▸</span>
        </button>
      }
      text={tooltip}
    />
  );
}
```

- [ ] **Step 4: Update the component to use drillLevel**

Replace the body of `TaxDetailFlowTable` with the drill-down-aware version:

```typescript
export function TaxDetailFlowTable({ years, onYearClick }: TaxDetailFlowTableProps) {
  const [drillLevel, setDrillLevel] = useState<DrillLevel>("top");
  const transitions = detectRegimeTransitions(years);

  // Choose columns based on drill level
  const activeColumns: Column[] = drillLevel === "above_line"
    ? aboveLineColumns(years)
    : drillLevel === "below_line"
      ? belowLineColumns()
      : COLUMNS;

  // Bold column keys (totals/winners)
  const boldKeys = new Set(["al_total", "bl_tax_deductions"]);

  // Make Above-Line and Below-Line headers clickable at top level
  const renderHeader = (col: Column) => {
    if (drillLevel === "top" && col.key === "aboveLineDeductions") {
      return (
        <DrillHeader
          label={col.label}
          tooltip={col.tooltip ?? ""}
          onClick={() => setDrillLevel("above_line")}
        />
      );
    }
    if (drillLevel === "top" && col.key === "belowLineDeductions") {
      return (
        <DrillHeader
          label={col.label}
          tooltip={col.tooltip ?? ""}
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
        <nav className="mb-2 text-xs text-gray-400">
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
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-gray-900 text-xs uppercase text-gray-400">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-900 px-3 py-2 text-left">Year</th>
              <th className="px-3 py-2 text-left">Age</th>
              {activeColumns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2 text-right font-medium ${boldKeys.has(col.key) ? "text-gray-200" : ""}`}
                >
                  {renderHeader(col)}
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
                  {activeColumns.map((col) => {
                    const v = col.value(y);
                    const formatter = col.formatter ?? formatCell;
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-right tabular-nums ${
                          boldKeys.has(col.key)
                            ? "font-semibold"
                            : v === 0
                              ? "text-gray-600"
                              : ""
                        }`}
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
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Clean (or pre-existing errors in year-range-slider only).

- [ ] **Step 6: Commit**

```bash
git add src/components/cashflow/tax-detail-flow-table.tsx
git commit -m "feat(deductions): add above-line and below-line drill-down to tax detail flow table"
```

---

## Task 5: Run full test suite + manual smoke

**Files:** None

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 2: Manual smoke test**

1. Open tax detail modal → Federal Tax Breakdown tab
2. Verify "Above-Line Deduct" and "Below-Line Deduct" headers show blue text with `▸`
3. Click "Above-Line Deduct" → expands to sub-columns (Retirement Contributions, Above-Line Total at minimum)
4. Breadcrumb shows "Federal Tax Breakdown / Above-Line Deductions" — click to collapse
5. Click "Below-Line Deduct" → expands to Charitable, Taxes Paid, Interest Paid, Other Itemized, Itemized Total, Standard Deduction, Tax Deductions
6. "Tax Deductions" column is bold and shows `max(itemized, standard)` for each year
7. Client with no itemized deductions → Standard Deduction wins
8. Client with large charitable + property tax → Itemized wins
9. Zero-suppressed: columns that are $0 across all years are hidden (e.g., Manual Entries, Tagged Expenses when client has none)
10. Year-range slider still filters the drill-down view correctly
