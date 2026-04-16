# Tax Engine Drill-Down UI — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Depends on:** Tax engine foundation ([2026-04-16-tax-engine-design.md](./2026-04-16-tax-engine-design.md)) — merged

## Overview

Add a multi-year tax detail modal to the cashflow report that shows how income and tax calculation evolve across the full projection. Complements the existing single-year per-source tax modal (from the CMA work) which stays in place. The new modal renders two tables — Income Breakdown and Tax Flow — each with one row per projection year.

The engine already emits everything needed: `taxResult.income`, `taxResult.flow`, and `taxResult.diag` are populated on every `ProjectionYear` when bracket mode is active (and populated as zeros in flat mode, which is still informative).

## User-Facing Flow

1. Advisor opens the Cashflow Report for a client
2. Clicks the **Expenses** column header (existing DrillBtn pattern) → expenses drill opens
3. Inside the expenses drill, clicks the **Taxes** column header (converted to a DrillBtn) → multi-year Tax Detail modal opens
4. Modal shows two stacked tables: Income Breakdown (top) + Tax Flow (bottom), both spanning all projection years
5. Advisor can:
   - Hover any column header → tooltip explains the metric
   - Click any year cell → existing per-source TaxDrillModal opens for that year (click-through)
   - Spot regime transitions via colored left-border indicators on year rows (first AMT year, first NIIT year, retirement year, marginal rate jumps)

The existing per-year tax cell behavior (click a tax cell → per-source breakdown modal) is unchanged.

## Architecture

```
src/components/cashflow/
  tax-detail-modal.tsx              CREATE — top-level modal component
  tax-detail-income-table.tsx       CREATE — Income Breakdown table
  tax-detail-flow-table.tsx         CREATE — Tax Flow table
  tax-detail-tooltip.tsx            CREATE — reusable header-tooltip component
  tax-regime-indicators.ts          CREATE — pure helper for transition detection
  __tests__/tax-regime-indicators.test.ts  CREATE

src/components/cashflow-report.tsx  MODIFY
  - Convert Taxes column header from plain text to a DrillBtn-style button
  - Add state for showTaxDetail boolean
  - Mount <TaxDetailModal years={years} clientData={clientData} onOpenYearDetail={setTaxDrillModal} />
```

**Why separate files:** `cashflow-report.tsx` is already 1,400+ lines. Adding another modal with two tables inline would push it past 2,000. Splitting keeps each file focused (100–300 lines each), enables easy unit testing of `tax-regime-indicators`, and matches the existing `components/import/` and `components/cashflow/` subfolder patterns.

**Why separate table components:** the Income and Flow tables share layout conventions (sticky year column, horizontal scroll, tooltips) but have distinct column definitions and no shared state. Splitting them makes each easy to reason about and modify independently.

## Tables

### Table 1: Income Breakdown (11 columns)

| Column | Source field | Tooltip |
|---|---|---|
| Year | `year` | — |
| Age | `ages.client` (+ `ages.spouse` if present) | Client's age; spouse age shown as secondary line |
| Earned Income | `taxResult.income.earnedIncome` | Wages and active business income. Subject to FICA and bracket tax. |
| Taxable SS | `taxResult.income.taxableSocialSecurity` | Portion of Social Security benefits subject to federal tax per IRS Pub 915 provisional-income formula. |
| Ordinary Income | `taxResult.income.ordinaryIncome` | Taxable interest, non-qualified dividends, IRA distributions, RMDs. Taxed at bracket rates. |
| Dividends | `taxResult.income.dividends` | Qualified dividends (preferential LTCG rates). |
| LT Cap Gains | `taxResult.income.capitalGains` | Long-term capital gains. Taxed at 0/15/20% stacked on ordinary income. |
| ST Cap Gains | `taxResult.income.shortCapitalGains` | Short-term capital gains. Taxed as ordinary income but tracked separately for NIIT. |
| Total Income | `taxResult.income.totalIncome` | Sum of all taxable income items. Feeds into the AGI calc. |
| Non-Taxable | `taxResult.income.nonTaxableIncome` | Muni bond interest, Roth distributions, non-taxable SS portion. Informational only. |
| Gross Total Income | `taxResult.income.grossTotalIncome` | Total + Non-Taxable. Denominator for effective tax rate. |

### Table 2: Tax Flow (18 columns)

| Column | Source field | Tooltip |
|---|---|---|
| Year | `year` | — |
| Age | computed | — |
| Total Income | `taxResult.income.totalIncome` | Taxable income before deductions. |
| Above-Line Deduct | `taxResult.flow.aboveLineDeductions` | HSA, traditional IRA, self-employment tax half, etc. Subtracted to get AGI. (v1: always $0) |
| AGI | `taxResult.flow.adjustedGrossIncome` | Adjusted Gross Income — also the MAGI used for NIIT. |
| Below-Line Deduct | `taxResult.flow.belowLineDeductions` | Standard or itemized deduction (whichever is larger). |
| QBI | `taxResult.flow.qbiDeduction` | Section 199A pass-through deduction (20% of QBI, capped). |
| Taxable Income | `taxResult.flow.taxableIncome` | AGI minus below-line minus QBI. |
| Tax Base | `taxResult.flow.incomeTaxBase` | Taxable income minus LTCG/qual div (which get preferential rates). This is the base for bracket tax. |
| Regular Fed | `taxResult.flow.regularFederalIncomeTax` | Progressive bracket tax on Tax Base. |
| Cap Gains Tax | `taxResult.flow.capitalGainsTax` | 0/15/20% tax on LT cap gains + qualified dividends stacked above ordinary. |
| AMT Add'l | `taxResult.flow.amtAdditional` | Additional AMT owed when tentative AMT exceeds regular tax. $0 if regular ≥ AMT. |
| NIIT | `taxResult.flow.niit` | 3.8% Net Investment Income Tax on investment income above the MAGI threshold. |
| Addl Medicare | `taxResult.flow.additionalMedicare` | 0.9% additional Medicare on wages above the threshold ($250k MFJ / $200k single). |
| FICA | `taxResult.flow.fica` | Social Security (6.2% up to wage base) + Medicare (1.45%). |
| State | `taxResult.flow.stateTax` | Flat state rate × taxable income (MVP simplification — bracket-based state tax deferred). |
| Total Tax | `taxResult.flow.totalTax` | All federal + state + FICA combined. |
| Marginal Rate | `taxResult.diag.marginalFederalRate` | Federal marginal rate at this year's Taxable Income. The "next dollar of income" rate. |

### First-Year Regime Transitions (enhancement #6)

A `tax-regime-indicators.ts` pure helper takes `ProjectionYear[]` and returns `Record<year, TransitionType[]>`. Each transition produces a colored left-border indicator on the year cell plus a tooltip explaining the cause.

| Transition | Detection | Indicator | Tooltip |
|---|---|---|---|
| First year AMT applies | `amtAdditional > 0` where prior year was 0 | Amber left border | First year AMT applies. Usually driven by high AGI phasing out your AMT exemption. |
| First year NIIT applies | `niit > 0` where prior year was 0 | Amber left border | First year NIIT applies. MAGI now exceeds the $250k MFJ / $200k single threshold. |
| First year Additional Medicare applies | `additionalMedicare > 0` where prior year was 0 | Amber left border | First year additional Medicare applies. Earned income now exceeds the threshold. |
| Retirement (FICA→0) | `fica === 0` where prior year was > 0 | Green left border | First year with no FICA. Earned income has stopped. |
| Marginal rate jump ≥ 5pts (upward only) | `marginalFederalRate` − prior ≥ 0.05 | Blue left border | Marginal rate jumped {X} pts — you crossed into a higher bracket this year. |

First projection year never triggers a transition (no prior year to compare).

## Layout & Interactions

- Modal sized ~90% viewport width, 80% viewport height; scrollable both directions
- Two tables stacked vertically; each horizontally scrollable independently on narrow screens
- Year column sticky-left in both tables so numbers stay aligned when scrolling
- Numbers right-aligned, currency format (no decimals); `$0` dimmed for zero values
- Column headers show an info icon (ⓘ) that reveals the tooltip on hover/focus
- Click a YEAR cell → opens existing per-year `TaxDrillModal` for that year (click-through)
- Close button (×) top-right; ESC key also closes
- Clicking the modal backdrop closes it (matches existing TaxDrillModal pattern)

## Data Flow

**Already available on each `ProjectionYear`** (from the tax engine foundation):
- `taxResult.income.*` — all income columns
- `taxResult.flow.*` — all tax flow columns
- `taxResult.diag.marginalFederalRate` — marginal rate column
- `ages.client`, `ages.spouse` — age column

**UI-side computations:**
- `tax-regime-indicators.ts` — pure function detecting first-year transitions
- Age display helper — formats as `"64"` or `"64 / 62"` if spouse
- Tooltip copy — hardcoded strings in `tax-detail-tooltip.tsx`

**Flat-mode handling:**
- In flat mode the engine emits $0 for most flow fields (AMT/NIIT/QBI/FICA/Additional Medicare). The table still renders with $0 dimmed — advisor sees that flat mode doesn't compute those numbers, which is informative rather than a bug.
- `marginalFederalRate` in flat mode equals the flat federal rate (engine already populates this via the TaxResult shim).

**No backend changes.** Everything is plumbed from the existing engine.

## Testing Strategy

### Unit tests (vitest)

**`tax-regime-indicators.test.ts`** — the only pure-logic file needing tests:
- No transitions when all years look the same
- Detects first year AMT adds (amtAdditional > 0 where prior year was 0)
- Detects first year NIIT applies
- Detects first year Additional Medicare applies
- Detects FICA→0 retirement transition
- Detects marginal rate jump ≥5 percentage points
- First year in projection treated as baseline (no transition)
- Handles empty array and single-year array without crashing

### No React component tests

The repo has no React testing library set up and no existing component tests. Adding RTL for this single feature isn't worth the setup work. Manual smoke testing covers the UI layer.

### Manual smoke test (mandatory before merge)

1. Start dev server, open a real client with bracket mode enabled
2. Navigate: Cashflow → Expenses → click "Taxes" column header → multi-year modal opens
3. Verify both tables render with real numbers for the full projection
4. Hover a column header → tooltip appears with the explanation
5. Click a year row → existing per-year TaxDrillModal opens for that year (click-through)
6. Close modals → returns to cashflow report cleanly
7. Flip to flat mode in assumptions, reopen → AMT/NIIT/QBI columns show $0 (not missing)
8. Find a year where AMT first applies → verify the amber left border is there and the tooltip explains it
9. Run `npm test` — all existing tests still green + new `tax-regime-indicators` tests green

### Edge cases to manually verify

- Projection with only 1 year (plan start == plan end) — tables render without crashing
- Projection where no transitions ever happen — no indicators, tables render cleanly
- Spouse-absent client — age column shows single age, not "N / NaN"

## Out of Scope / Future Work

- **CSV export button** — deferred to a separate, report-wide export project (all cashflow reports)
- **Year-range slider at the top of the page** — planned as a separate page-wide feature that will scope charts and tables to a selected year window
- **Zero-column collapse** — considered but declined; show all columns always for transparency
- **React component tests** — would require RTL setup; defer until there's a repo-wide testing story
- **"Show AMT credit carryover" column** — the engine doesn't track multi-year AMT credit state in v1
- **Per-state bracket-based state tax** — deferred to a future tax-engine work item

## Phases for Implementation

Single phase, one plan. Expected ~7–9 tasks:
1. `tax-regime-indicators.ts` + tests
2. `tax-detail-tooltip.tsx` (reusable component)
3. `tax-detail-income-table.tsx`
4. `tax-detail-flow-table.tsx`
5. `tax-detail-modal.tsx` (composes the above)
6. Wire into `cashflow-report.tsx` (convert Taxes header → DrillBtn, add state, mount modal)
7. Manual smoke test checklist + any polish

Estimated 2–3 sessions to execute end-to-end via subagent dispatches.
