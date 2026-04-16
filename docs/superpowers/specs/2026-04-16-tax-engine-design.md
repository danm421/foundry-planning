# Robust Tax Engine — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**FUTURE_WORK item:** #2 (P8 E3 L9 = 20)
**Source data:** `data/tax/2022-2026 Tax Values Updated.xlsx`

## Overview

Replace the existing 9-line flat-rate tax function (`taxableIncome × (federalRate + stateRate)`) with a real progressive-bracket federal tax engine driven by an advisor-maintained workbook. Adds bracket math for ordinary income and long-term capital gains across four filing statuses, plus AMT, NIIT, additional Medicare, FICA, SS taxability, and QBI. State tax stays flat. Trust/estate brackets and IRMAA are deferred.

The engine is opt-in per client via a new `tax_engine_mode` toggle so existing plans keep their current flat-rate behavior until the advisor chooses to switch.

## MVP Scope

| In scope | Deferred |
|---|---|
| Federal income brackets, 4 filing statuses (MFJ, Single, HoH, MFS) | IRMAA |
| LT capital gains + qualified dividends (0/15/20%) | Trust/estate brackets |
| Standard deduction by filing status | State income tax brackets (flat stays) |
| SS wage base + Medicare (FICA) | Roth conversion optimizer |
| Additional Medicare (0.9%) | Self-employment tax |
| AMT (exemption, phase-out, 26/28% rates) | AMT credit carryover |
| NIIT (3.8% on investment income above MAGI threshold) | Tax credits (child, dependent care, etc.) |
| SS taxability (provisional-income formula, up to 85%) | Itemized deduction line-by-line |
| QBI / Section 199A (simplified, no SSTB rules) | |
| Flat state rate (existing) | |

## Architecture

```
src/
  lib/tax/
    types.ts              # TaxYearParameters, TaxResult, TaxBreakdown
    resolver.ts           # getTaxParams(year, rows[], rates) → inflate-forward
    federal.ts            # progressive bracket math
    capGains.ts           # 0/15/20% stacking on top of ordinary
    amt.ts                # AMTI, exemption phaseout, 26/28% rates
    niit.ts               # 3.8% × min(investment income, MAGI - threshold)
    fica.ts               # SS + Medicare + additional Medicare on earned income
    qbi.ts                # 20% × QBI, capped at taxable-income-minus-cap-gains
    ssTaxability.ts       # provisional-income formula (0/50/85%)
    state.ts              # flat rate × taxable income (existing behavior, relocated)
    calculate.ts          # orchestrator: ordered call sequence
    constants.ts          # INDEXED_FIELDS rounding steps, STATUTORY_FIXED values
    __tests__/            # one test file per source file + integration

  db/schema.ts            # add taxYearParameters table + plan_settings columns
  db/migrations/0015_tax_year_parameters.sql
  db/migrations/0016_plan_settings_tax_assumptions.sql

  engine/
    tax.ts                # REPLACE — thin wrapper that routes to flat or bracket
    projection.ts         # one line change at line 335 (call site)
    types.ts              # add `taxResult?: TaxResult` to ProjectionYear

scripts/
  seed-tax-data.ts        # parse data/tax/*.xlsx → upsert tax_year_parameters
  parsers/
    irs-updates-sheet.ts  # parses the "2022-2026 IRS Updates" sheet only

data/tax/
  2022-2026 Tax Values Updated.xlsx   # canonical source (already committed)
  snapshot.json                        # human-readable JSON dump for PR diffs
```

**Why `lib/tax/` lives outside `src/engine/`:** the tax calculations are pure tax-code logic with no projection-engine dependencies. The engine consumes the tax library, not the other way around. Same separation pattern as `lib/extraction/` and `lib/cma-seed.ts`.

**Why one file per surcharge/calc:** AMT alone is ~80 lines of bracket math. Mixing it with NIIT in one file would muddy both. The orchestrator (`calculate.ts`) owns calculation order, which is the most error-prone part — it deserves to be in one place with a clear top-to-bottom read.

## Data Model

### New table: `tax_year_parameters` (one row per tax year)

JSONB-heavy hybrid: scalars stay as columns, repeated/structured data goes into JSONB.

```ts
export const taxYearParameters = pgTable("tax_year_parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  year: integer("year").notNull().unique(),

  // Brackets (JSONB, shape per filing status)
  // { mfj: [{from, to, rate}, ...], single: [...], hoh: [...], mfs: [...] }
  incomeBrackets:    jsonb("income_brackets").notNull(),
  capGainsBrackets:  jsonb("cap_gains_brackets").notNull(),

  // Standard deduction (one scalar per filing status)
  stdDeductionMfj:    decimal("std_deduction_mfj",    { precision: 10, scale: 2 }).notNull(),
  stdDeductionSingle: decimal("std_deduction_single", { precision: 10, scale: 2 }).notNull(),
  stdDeductionHoh:    decimal("std_deduction_hoh",    { precision: 10, scale: 2 }).notNull(),
  stdDeductionMfs:    decimal("std_deduction_mfs",    { precision: 10, scale: 2 }).notNull(),

  // AMT
  amtExemptionMfj:           decimal("amt_exemption_mfj",            { precision: 12, scale: 2 }).notNull(),
  amtExemptionSingleHoh:     decimal("amt_exemption_single_hoh",     { precision: 12, scale: 2 }).notNull(),
  amtExemptionMfs:           decimal("amt_exemption_mfs",            { precision: 12, scale: 2 }).notNull(),
  amtBreakpoint2628MfjShoh:  decimal("amt_breakpoint_2628_mfj_shoh", { precision: 12, scale: 2 }).notNull(),
  amtBreakpoint2628Mfs:      decimal("amt_breakpoint_2628_mfs",      { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartMfj:       decimal("amt_phaseout_start_mfj",       { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartSingleHoh: decimal("amt_phaseout_start_single_hoh",{ precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartMfs:       decimal("amt_phaseout_start_mfs",       { precision: 12, scale: 2 }).notNull(),

  // FICA
  ssTaxRate:                   decimal("ss_tax_rate",                   { precision: 5, scale: 4 }).notNull(),
  ssWageBase:                  decimal("ss_wage_base",                  { precision: 12, scale: 2 }).notNull(),
  medicareTaxRate:             decimal("medicare_tax_rate",             { precision: 5, scale: 4 }).notNull(),
  addlMedicareRate:            decimal("addl_medicare_rate",            { precision: 5, scale: 4 }).notNull(),
  addlMedicareThresholdMfj:    decimal("addl_medicare_threshold_mfj",    { precision: 12, scale: 2 }).notNull(),
  addlMedicareThresholdSingle: decimal("addl_medicare_threshold_single", { precision: 12, scale: 2 }).notNull(),
  addlMedicareThresholdMfs:    decimal("addl_medicare_threshold_mfs",    { precision: 12, scale: 2 }).notNull(),

  // NIIT (rate + thresholds, all statutorily fixed)
  niitRate:            decimal("niit_rate",            { precision: 5, scale: 4 }).notNull(),
  niitThresholdMfj:    decimal("niit_threshold_mfj",    { precision: 12, scale: 2 }).notNull(),
  niitThresholdSingle: decimal("niit_threshold_single", { precision: 12, scale: 2 }).notNull(),
  niitThresholdMfs:    decimal("niit_threshold_mfs",    { precision: 12, scale: 2 }).notNull(),

  // QBI / Section 199A
  qbiThresholdMfj:          decimal("qbi_threshold_mfj",            { precision: 12, scale: 2 }).notNull(),
  qbiThresholdSingleHohMfs: decimal("qbi_threshold_single_hoh_mfs", { precision: 12, scale: 2 }).notNull(),
  qbiPhaseInRangeMfj:       decimal("qbi_phase_in_range_mfj",       { precision: 12, scale: 2 }).notNull(),
  qbiPhaseInRangeOther:     decimal("qbi_phase_in_range_other",     { precision: 12, scale: 2 }).notNull(),

  // Contribution limits (held for upcoming Roth/contribution work)
  ira401kElective:    decimal("ira_401k_elective",     { precision: 10, scale: 2 }).notNull(),
  ira401kCatchup50:   decimal("ira_401k_catchup_50",   { precision: 10, scale: 2 }).notNull(),
  ira401kCatchup6063: decimal("ira_401k_catchup_60_63",{ precision: 10, scale: 2 }),  // null pre-2025
  iraTradLimit:       decimal("ira_trad_limit",        { precision: 10, scale: 2 }).notNull(),
  iraCatchup50:       decimal("ira_catchup_50",        { precision: 10, scale: 2 }).notNull(),
  simpleLimitRegular: decimal("simple_limit_regular",  { precision: 10, scale: 2 }).notNull(),
  simpleCatchup50:    decimal("simple_catchup_50",     { precision: 10, scale: 2 }).notNull(),
  hsaLimitSelf:       decimal("hsa_limit_self",        { precision: 10, scale: 2 }).notNull(),
  hsaLimitFamily:     decimal("hsa_limit_family",      { precision: 10, scale: 2 }).notNull(),
  hsaCatchup55:       decimal("hsa_catchup_55",        { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### `plan_settings` — three new columns

```sql
ALTER TABLE plan_settings
  ADD COLUMN tax_engine_mode tax_engine_mode_enum NOT NULL DEFAULT 'flat',
  ADD COLUMN tax_inflation_rate decimal(5,4),
  ADD COLUMN ss_wage_growth_rate decimal(5,4);

CREATE TYPE tax_engine_mode_enum AS ENUM ('flat', 'bracket');
```

`tax_inflation_rate` and `ss_wage_growth_rate` are nullable. Resolver code defaults them:
```ts
const taxInfl = planSettings.taxInflationRate ?? planSettings.inflationRate;
const ssWageGrowth = planSettings.ssWageGrowthRate ?? planSettings.inflationRate + 0.005;
```

Existing clients get sensible defaults without a data migration; the schema change is forward-compatible.

### `clients.planStartYear` validation

Server-side validation on the plan-settings PUT endpoint rejects `planStartYear < currentYear`. UI shows an inline error. Existing clients with past start years are not retroactively fixed (next save fails and prompts the user). This guarantees the engine never has to handle past years missing from the workbook.

### Migration files

- `0015_tax_year_parameters.sql` — create the table
- `0016_plan_settings_tax_assumptions.sql` — add the three columns + enum

## Engine API

### Inputs

```ts
function calculateTaxYear(input: {
  year: number;
  filingStatus: FilingStatus;
  taxDetail: ProjectionYear["taxDetail"];   // already plumbed from CMA work
  socialSecurity: number;                   // gross SS for taxability calc
  aboveLineDeductions?: number;             // v1: stub at 0
  itemizedDeductions?: number;              // v1: take std if 0, else max(std, itemized)
  taxParams: TaxYearParameters;             // resolved, possibly inflated
  flatStateRate: number;                    // existing planSetting
}): TaxResult;
```

### Outputs (designed to feed the cash-flow drill-down 1:1)

```ts
interface TaxResult {
  // Income breakdown — drives the "Income" drill-down table
  income: {
    earnedIncome: number;                  // wages + business
    taxableSocialSecurity: number;         // result of provisional-income formula
    ordinaryIncome: number;                // taxable interest, non-qual dividends, etc.
    dividends: number;                     // qualified
    capitalGains: number;                  // long-term
    shortCapitalGains: number;             // ST (taxed as ordinary; tracked separately)
    totalIncome: number;                   // sum of taxable items above
    nonTaxableIncome: number;              // muni interest, Roth, non-taxable SS portion
    grossTotalIncome: number;              // total + non-taxable
  };

  // Deduction & tax-calc flow — drives the "Tax Calc" drill-down table
  flow: {
    aboveLineDeductions: number;           // v1: 0
    adjustedGrossIncome: number;
    qbiDeduction: number;                  // 20% × QBI, capped
    belowLineDeductions: number;           // max(std, itemized)
    taxableIncome: number;
    incomeTaxBase: number;                 // taxableIncome - LTCG - qualDiv
    regularTaxCalc: number;                // bracket math on incomeTaxBase
    amtCredit: number;                     // v1: 0 (no carryover modeled)
    taxCredits: number;                    // v1: 0
    regularFederalIncomeTax: number;
    capitalGainsTax: number;               // 0/15/20% stacking
    amtAdditional: number;                 // amount AMT exceeds regular (if any)
    niit: number;                          // 3.8% × min(investment, AGI - threshold)
    additionalMedicare: number;            // 0.9% × earned > threshold
    fica: number;                          // SS + Medicare (excludes addl)
    stateTax: number;                      // flat rate × taxable income (matches existing behavior)
    totalFederalTax: number;
    totalTax: number;                      // federal + state + fica
  };

  // Diagnostics
  diag: {
    marginalFederalRate: number;
    effectiveFederalRate: number;          // totalFederalTax / grossTotalIncome
    bracketsUsed: TaxYearParameters;       // post-inflation params actually used
    inflationFactor: number;               // 1.0 if exact year, else compounded
  };
}
```

### Calculation order (in `calculate.ts`)

The order matters — get it wrong and AMT/NIIT/QBI numbers go sideways.

1. Categorize income from `taxDetail` → fill `income` block
2. Compute SS taxability → set `income.taxableSocialSecurity` and `nonTaxableIncome`
3. Apply above-line deductions → AGI
4. Compute QBI deduction (depends on taxable income before QBI)
5. Apply below-line deductions (max of std vs itemized) → taxable income
6. Split taxable income into ordinary base vs LT cap gains/qual div → `incomeTaxBase`
7. Run brackets on `incomeTaxBase` → `regularTaxCalc`
8. Compute cap gains tax (stacked on top of ordinary income)
9. Compute AMT separately, take excess over regular → `amtAdditional`
10. Compute NIIT, addl Medicare, FICA, state
11. Sum up `totalFederalTax` and `totalTax`

## Multi-Year Extrapolation

### Resolver

```ts
function resolveTaxYearParams(
  targetYear: number,
  rows: TaxYearParameters[],   // sorted by year asc
  rates: { taxInflationRate: number; ssWageGrowthRate: number }
): { params: TaxYearParameters; inflationFactor: number; sourceYear: number };
```

**Logic:**
- Exact year match → return row, `inflationFactor = 1.0`
- Future year → take latest row, compute `inflationFactor = (1 + taxInflationRate)^(targetYear - latestYear)`, multiply each indexed dollar threshold, floor to its rounding step
- SS wage base uses `ssWageGrowthRate` instead of `taxInflationRate`
- Past years are rejected by upstream validation (`planStartYear >= currentYear`); no resolver branch needed

### Indexed fields and rounding (constants in `lib/tax/constants.ts`)

| Field group | Rounds to |
|---|---|
| Income brackets, cap gains, std deduction, QBI thresholds, HSA limits | $50 |
| AMT exemption, AMT 26/28 breakpoint, AMT phase-out start | $100 |
| 401k/403b/457 limits, IRA limits, SIMPLE limits, IRA catch-up | $500 |
| Gift annual exclusion | $1,000 |
| Estate/GSTT exclusion | $10,000 |
| SS wage base | $300 (statutory SSA formula; uses `ssWageGrowthRate`) |

Anything not in the constants stays unindexed. Statutorily fixed: NIIT rate + thresholds, additional Medicare rate + thresholds, all bracket rates (10/12/22/...), SS rate (6.2%), Medicare rate (1.45%).

### Memoization

Resolver caches per-year results within a projection run. ~30-50 lookups per `recompute()` call; memoize keyed on `year`.

## Seed Pipeline

### Run command
```bash
npm run seed:tax-data           # alias for: npx tsx scripts/seed-tax-data.ts
npm run seed:tax-data -- --dry-run
npm run seed:tax-data -- --write-snapshot
```

### Parser strategy

Use `xlsx` (already a dependency). Parse only the `2022-2026 IRS Updates` sheet — the cleanly-formatted consolidated sheet. The other 20 sheets in the workbook remain informational for advisor reference.

**Section-anchored scrape:** the sheet has named sections ("Standard Deduction by Filing Status", "Federal Income Tax Brackets...", etc.) followed by a header row + one data row per year. The parser walks rows looking for known section headers, then for each section knows the column order and expected years, and extracts year-keyed objects.

Each section parser is a small function (~10-15 lines): `parseStandardDeduction(rows: Row[]): Record<Year, StdDeduction>`.

### Validation gates (fail loud, no DB write)

- Each year 2022-2026 must produce a complete `TaxYearParameters` object — error if any field missing
- Bracket arrays must be monotonically increasing
- Sum of bracket spans must be sane (no negative ranges)
- Rates must be in [0, 1]
- Print summary table (year, std_deduction_mfj, top_bracket_mfj, ss_wage_base) for eyeballing before commit

### Idempotency

`onConflictDoUpdate(year)`. Re-running the script overwrites existing rows. Safe to run any number of times.

### Statutorily-fixed constants (NOT in workbook, code-only)

```ts
// lib/tax/constants.ts
export const STATUTORY_FIXED = {
  niitRate: 0.038,
  niitThresholdMfj: 250000,
  niitThresholdSingle: 200000,
  niitThresholdMfs: 125000,
  addlMedicareRate: 0.009,
  addlMedicareThresholdMfj: 250000,
  addlMedicareThresholdSingle: 200000,
  addlMedicareThresholdMfs: 125000,
};
```

The seed script writes these into every year row alongside the workbook data.

### Snapshot for PR review

`--write-snapshot` dumps the full set of would-be-inserted rows to `data/tax/snapshot.json`. Committed alongside the binary XLSX so PRs that bump tax data have a human-readable diff.

## Engine Integration

### Single replace in `projection.ts:335`

Today:
```ts
const taxes = calculateTaxes(taxableIncome, planSettings);
```

After:
```ts
const taxResult = planSettings.taxEngineMode === 'bracket'
  ? calculateTaxYear({ year, filingStatus: client.filingStatus, taxDetail, ... })
  : calculateTaxYearFlat({ taxableIncome, planSettings });
const taxes = taxResult.flow.totalTax;
```

Both branches return the same `TaxResult` shape. Drill-down UI works identically; flat mode just leaves AMT/NIIT/QBI fields at zero.

### Loading tax params once per projection run

Top of `recompute()`:
```ts
const taxResolver = createTaxResolver(taxYearRows, {
  taxInflationRate: planSettings.taxInflationRate ?? planSettings.inflationRate,
  ssWageGrowthRate: planSettings.ssWageGrowthRate ?? planSettings.inflationRate + 0.005,
});
// In year loop:
const resolvedTaxParams = taxResolver.getYear(year);   // memoized
```

DB query lives in the route (`src/app/api/clients/[id]/projection-data/route.ts`) and passes `taxYearRows` into `recompute()` as a parameter. Engine stays DB-agnostic (current pattern).

### `ProjectionYear` extension

```ts
export interface ProjectionYear {
  // existing fields unchanged
  taxResult?: TaxResult;   // NEW — drives drill-down UI
}
```

Optional in the type only because old in-memory cached runs may lack it. Fresh `recompute()` always populates.

### Plan-settings UI

- `tax-rates-form.tsx` adds a toggle at top: **"Tax calculation method: [ Flat rate ] [ Bracket-based ]"**
  - Flat → flatFederalRate + flatStateRate fields visible; advanced inflation overrides hidden
  - Bracket → flatFederalRate hidden, flatStateRate still visible (state stays flat in MVP), advanced overrides revealed
- `growth-inflation-form.tsx` adds a collapsible "Advanced" section with `taxInflationRate` and `ssWageGrowthRate`, each defaulting to the general inflation rate's value as placeholder

### Cash-flow drill-down UI (separate phase)

Built in a follow-up phase after the engine is proven by tests. Components:
- `src/components/cashflow/tax-drilldown-modal.tsx` (or expandable row)
- Two table sections matching the screenshots: "Income breakdown" + "Tax calculation flow"
- Triggered by clicking the tax cell in the existing cashflow report

The engine returns `taxResult` regardless of UI state — UI can ship later without engine changes.

## Testing Strategy

### Unit tests per `lib/tax/` module

One test file per source file. Each module is small enough to test exhaustively.

- **federal.test.ts** — bracket math at boundaries, all 4 filing statuses, top-bracket math, $0/negative guards
- **capGains.test.ts** — stacking on top of ordinary, 0% bracket fill, qualified dividends pooled with LTCG, ST treated as ordinary
- **amt.test.ts** — exemption phase-out above $1M MFJ, 26/28% transition, AMT-exceeds-regular path
- **niit.test.ts** — MAGI threshold, investment-vs-excess minimum, dividends-only case
- **fica.test.ts** — SS wage cap, additional Medicare on excess
- **qbi.test.ts** — under threshold (full 20%), in phase-in (linear), above phase-in (zero in v1 simplified — see caveat below), capped at taxable-income-minus-LTCG

> **QBI v1 caveat:** Real Section 199A above the phase-in range distinguishes SSTB (Specified Service Trade or Business — health, law, accounting, consulting, etc.) from non-SSTB. SSTB businesses get $0 above phase-in; non-SSTB get a deduction capped by W-2 wages paid. v1 collapses both to $0 above phase-in. This **under-deducts** for non-SSTB business owners (a known v1 limitation). v2 should add an `is_sstb` flag on business income sources and W-2 wages tracking. Documented in MVP scope row "no SSTB rules".
- **ssTaxability.test.ts** — three brackets (0/50/85%) of provisional income
- **resolver.test.ts** — exact match, 1-year forward, 30-year forward, NIIT stays fixed, IRA limit rounded to $500

### Orchestrator integration: `calculate.test.ts`

5 hand-verified scenarios end-to-end (run each through TurboTax to lock expected numbers):

1. MFJ retirees: $80k SS + $40k IRA + $10k LTCG, 2026
2. MFJ working couple: $300k W-2 + $50k qual div + $20k LTCG, 2026
3. HNW HoH: $1.5M ordinary + $500k LTCG, 2026
4. Single retiree: $30k SS + $20k IRA + $5k qual div, 2026
5. MFJ small business: $200k QBI + $80k W-2, 2026

### Parser test: `seed-tax-data.test.ts`

- Run parser against actual workbook
- Assert 5 year rows produced (2022-2026)
- Spot-check ~10 known-good values (`2026 std_deduction_mfj = $32,200`, etc.)
- Snapshot test: full JSON output committed

### Engine integration

Add to existing `projection.test.ts`:
- New: bracket-mode projection matches expected `expenses.taxes` for fixture year
- New: flat-mode projection matches the *old* `expenses.taxes` value (regression check)
- New: `taxResult` populated on every year in bracket mode

### Manual smoke test (advisor sanity)

Once UI ships, take a real client plan, flip the toggle, compare cash-flow tax line. Year-1 numbers should be within ±5% of TurboTax for the same income profile. Way off → debug before shipping.

### Out of scope for v1 testing

IRMAA, trust/estate brackets, state brackets, Roth optimizer interactions, AMT credit carryover.

## Phasing for Implementation Plan

The implementation plan should split into these phases, each ending in working/tested code:

1. **Data model** — `tax_year_parameters` table, `plan_settings` columns, migrations
2. **Seed pipeline** — XLSX parser + script, snapshot output, parser tests
3. **Tax library modules** — all `lib/tax/*.ts` files with their unit tests (federal → capGains → AMT → NIIT → FICA → QBI → ssTaxability → state → resolver → calculate)
4. **Engine integration** — wire `calculateTaxYear` into `projection.ts`, add `taxResult` to `ProjectionYear`, plan-settings UI toggle
5. **Cash-flow drill-down UI** — separate phase; ships after engine is proven

Phases 1-4 deliver a working bracket-based tax engine end-to-end, drivable from the assumptions UI. Phase 5 is the visualization on top.

## Open Questions / Followups (not blockers for v1)

- IRMAA: requires CMS data source; track as separate FUTURE_WORK item once engine ships
- Trust/estate brackets: data is in workbook already; could be a small follow-up
- AMT credit carryover: requires multi-year stateful tracking; defer until requested
- State income tax brackets: significant per-state data ingestion problem; defer indefinitely
- Removal of `flat_federal_rate` column: defer until bracket engine has been in production for ~6 months and no clients are still on flat
