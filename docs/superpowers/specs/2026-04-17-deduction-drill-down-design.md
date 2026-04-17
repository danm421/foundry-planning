# Deduction Drill-Down — Design Spec

**Date:** 2026-04-17
**Status:** Approved
**Depends on:** Auto-derived deductions (in progress on `feat/auto-derived-deductions`)

## Overview

Add drill-down columns to the Tax Detail modal's Federal Tax Breakdown tab for the Above-Line Deduct and Below-Line Deduct rows. Clicking either column header expands it into sub-columns showing the per-source breakdown, following the existing drill-down interaction pattern used in the cashflow report.

Above-line expands to show category-level totals (Retirement Contributions, Tagged Expenses, Manual Entries) with the total. Below-line expands to show itemized components (Charitable, Taxes Paid, Interest Paid, Other Itemized), the calculated Itemized Total, the Standard Deduction, and a final "Tax Deductions" column showing `max(itemizedTotal, standardDeduction)`.

## MVP Scope

**In scope:**
- `deductionBreakdown` object on `ProjectionYear` carrying per-source amounts
- Assembly logic in `projection.ts` (no changes to tax helpers)
- Above-line drill-down: Retirement Contributions, Tagged Expenses, Manual Entries, Total
- Below-line drill-down: Charitable, Taxes Paid (capped SALT), Interest Paid (mortgage), Other Itemized, Itemized Total, Standard Deduction, Tax Deductions (winner)
- Zero-suppression: sub-columns that are $0 across all visible years are hidden
- Breadcrumb navigation back to the collapsed view

**Out of scope:**
- Charitable v2 carry-forward columns (add when carry-forward ships)
- Medical expense deduction column
- Per-source drill-down within categories (e.g., clicking "Retirement Contributions" to see individual 401k/IRA accounts)
- Cell-level popovers for single-year detail

## Architecture

```
src/engine/types.ts                                     MODIFY
  - Add DeductionBreakdown interface
  - Add deductionBreakdown? to ProjectionYear

src/engine/projection.ts                                MODIFY (~40 lines)
  - Assemble deductionBreakdown from the 6 contribution sources
  - Attach to ProjectionYear output

src/components/cashflow/tax-detail-flow-table.tsx       MODIFY (~120 lines)
  - Add drillLevel state
  - Above-line expanded column set
  - Below-line expanded column set
  - Zero-suppression logic
  - Breadcrumb navigation

src/engine/__tests__/projection.test.ts                 MODIFY (+3 tests)
```

**Why on ProjectionYear, not TaxResult:** The tax calculator (`calculate.ts`) receives aggregate `aboveLineDeductions` and `itemizedDeductions` numbers — it doesn't know the source breakdown. The projection loop has visibility into all 6 contribution sources and assembles the breakdown there. Putting it on `ProjectionYear` alongside `taxResult` keeps the tax calculator pure.

## Data Model

### `DeductionBreakdown` interface

Added to `src/engine/types.ts`:

```typescript
export interface DeductionBreakdown {
  aboveLine: {
    retirementContributions: number;  // 401k/IRA from savings rules
    taggedExpenses: number;           // expenses with deductionType: "above_line"
    manualEntries: number;            // client_deductions with type: "above_line"
    total: number;
    bySource: Record<string, { label: string; amount: number }>;
  };
  belowLine: {
    charitable: number;              // charitable from expenses + manual rows
    taxesPaid: number;               // SALT (capped) from all property tax sources
    interestPaid: number;            // mortgage interest from deductible liabilities
    otherItemized: number;           // below_line expenses + manual below_line rows
    itemizedTotal: number;           // sum of the above four
    standardDeduction: number;       // from taxParams for the filing status
    taxDeductions: number;           // max(itemizedTotal, standardDeduction)
    bySource: Record<string, { label: string; amount: number }>;
  };
}
```

### `ProjectionYear` addition

```typescript
  deductionBreakdown?: DeductionBreakdown;
```

Populated only in bracket mode (when `useBracket === true`). Flat mode leaves it undefined.

## Engine Integration

### Assembly in `projection.ts`

After computing the 6 `DeductionContribution` objects and calling `aggregateDeductions`, build the breakdown:

```typescript
// Already computed:
// contributions[0] = deriveAboveLineFromSavings → { aboveLine: retirementTotal }
// contributions[1] = deriveAboveLineFromExpenses → { aboveLine: expenseAboveLineTotal }
// contributions[2] = deriveItemizedFromExpenses → { itemized, saltPool }
// contributions[3] = deriveMortgageInterestFromLiabilities → { itemized: interestTotal }
// contributions[4] = derivePropertyTaxFromAccounts → { saltPool }
// contributions[5] = sumItemizedFromEntries → { aboveLine, itemized, saltPool }

const retirementContributions = contributions[0].aboveLine;
const expenseAboveLine = contributions[1].aboveLine;
const manualAboveLine = contributions[5].aboveLine;

const charitableFromExpenses = /* sum of charitable-tagged expense amounts */;
const charitableFromManual = /* sum of manual charitable row amounts */;
const charitable = charitableFromExpenses + charitableFromManual;

const rawSalt = contributions[2].saltPool + contributions[4].saltPool + contributions[5].saltPool;
const taxesPaid = Math.min(rawSalt, saltCap(year));

const interestPaid = contributions[3].itemized;

const otherItemizedFromExpenses = /* sum of below_line-tagged expense amounts */;
const otherItemizedFromManual = /* sum of manual below_line row amounts */;
const otherItemized = otherItemizedFromExpenses + otherItemizedFromManual;

const itemizedTotal = charitable + taxesPaid + interestPaid + otherItemized;
const standardDeduction = resolved!.params.stdDeduction[filingStatus];
const taxDeductions = Math.max(itemizedTotal, standardDeduction);
```

**Note:** The individual contribution objects return category-level totals but don't distinguish charitable vs below_line within the itemized bucket. To get the per-category split, we need to compute them directly from the source data rather than extracting from the aggregated contributions.

Specifically, for below-line itemized breakdown:
- **charitable**: loop `allExpenses` where `deductionType === "charitable"` (inflated) + loop `data.deductions` where `type === "charitable"` (inflated)
- **otherItemized**: loop `allExpenses` where `deductionType === "below_line"` (inflated) + loop `data.deductions` where `type === "below_line"` (inflated)

These are cheap iterations over the same arrays already in scope. The `bySource` maps collect `{ label, amount }` entries keyed by source ID for potential future per-source drill-down.

### No changes to tax helpers

`calculate.ts`, `derive-deductions.ts`, and all `lib/tax/*.ts` files are unchanged. The breakdown is purely assembled in the projection loop.

## UI — Tax Detail Flow Table

### Drill-down state

Add a `drillLevel` state to `TaxDetailFlowTable`:

```typescript
type DrillLevel = "top" | "above_line" | "below_line";
const [drillLevel, setDrillLevel] = useState<DrillLevel>("top");
```

### Top level (existing)

The existing `COLUMNS` array is used. The Above-Line Deduct and Below-Line Deduct columns get clickable headers (styled like `DrillBtn` in the cashflow report — blue text with a `▸` indicator).

### Above-Line expanded

When `drillLevel === "above_line"`, columns become:

| Year | Age | Retirement Contributions | Tagged Expenses* | Manual Entries* | **Above-Line Total** |
|---|---|---|---|---|---|

Reads from `y.deductionBreakdown?.aboveLine.*`. The total column is bold.

*Zero-suppressed: if a sub-column is $0 for all visible years, it's omitted.

### Below-Line expanded

When `drillLevel === "below_line"`, columns become:

| Year | Age | Charitable | Taxes Paid | Interest Paid | Other Itemized* | Itemized Total | Standard Deduction | **Tax Deductions** |
|---|---|---|---|---|---|---|---|---|

Reads from `y.deductionBreakdown?.belowLine.*`. The "Tax Deductions" column is bold (rightmost). "Itemized Total" and "Standard Deduction" are shown side by side so the advisor can see which won.

*Zero-suppressed: "Other Itemized" hidden if $0 across all years.

### Breadcrumb

When drilled in, a breadcrumb appears above the table:

```
Federal Tax Breakdown / Above-Line Deductions
```

"Federal Tax Breakdown" is clickable and returns to `drillLevel === "top"`.

### Header tooltips

Each sub-column gets a tooltip explaining what it contains:
- **Retirement Contributions**: "401(k) and Traditional IRA employee elective deferrals"
- **Tagged Expenses**: "Expenses with Tax Treatment set to Above Line"
- **Manual Entries**: "Manual above-line deduction entries from the Deductions page"
- **Charitable**: "Charitable gift deductions from tagged expenses and manual entries"
- **Taxes Paid**: "State and local taxes (SALT), capped at $40,000 (OBBBA)"
- **Interest Paid**: "Mortgage interest from liabilities marked tax-deductible"
- **Other Itemized**: "Other below-line deductions from tagged expenses and manual entries"
- **Standard Deduction**: "IRS standard deduction for filing status, inflation-adjusted"
- **Tax Deductions**: "The greater of Itemized Total or Standard Deduction"

## Testing

### Engine integration — `projection.test.ts` (~3 tests)

- Bracket-mode client with 401k savings rule → `deductionBreakdown.aboveLine.retirementContributions === 23500` and `total` matches
- Bracket-mode client with property tax + deductible mortgage → `belowLine.taxesPaid > 0` and `belowLine.interestPaid > 0`
- Below-line winner is correct: `taxDeductions === Math.max(itemizedTotal, standardDeduction)`

### No React component tests

Follows existing pattern — manual smoke covers UI.

### Manual smoke checklist

1. Open tax detail modal → Federal Tax Breakdown tab
2. Click "Above-Line Deduct" header → expands to sub-columns showing per-source amounts
3. Breadcrumb shows "Federal Tax Breakdown / Above-Line Deductions" — click to collapse
4. Click "Below-Line Deduct" header → expands to sub-columns
5. "Tax Deductions" column shows `max(itemized, standard)` for each year
6. Client with no itemized deductions → Standard Deduction wins, Tax Deductions = Standard Deduction
7. Client with large charitable + property tax → Itemized wins
8. Sub-columns with all-zero values are hidden (e.g., Manual Entries when client has none)
9. Year-range slider filters the drill-down view correctly

## Followups

- **Charitable v2 carry-forward** — when carry-forward ships, add "Carry-forward Used" and "Carry-forward Remaining" columns to the below-line expansion
- **Per-source drill-down** — clicking a category column (e.g., "Retirement Contributions") could expand further to show individual accounts. Deferred — category-level is sufficient for now.
- **Medical expense deduction** — add column when medical expense feature ships
