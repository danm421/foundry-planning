# Auto-Derived Deductions — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Depends on:** Deduction types foundation (shipped as `b40983c`)

## Overview

Auto-derive deductions from data advisors already enter elsewhere, reducing duplicate entry and making the tax engine more accurate out-of-the-box:

1. **Expenses → deductions** — a new `deduction_type` select on expense rows. When set, the expense's annual amount flows into the engine as that deduction type.
2. **Mortgage interest → below-line deduction** — a new `is_interest_deductible` checkbox on liabilities. When checked, the year's interest portion (already computed by `amortizeLiability`) counts as a below-line deduction.
3. **Property taxes on real estate** — a new `annual_property_tax` + `property_tax_growth_rate` on accounts. Engine synthesizes a year-by-year expense line and contributes the amount to SALT (property tax).

Also renames the deduction type enum from the v1 five types (charitable_cash, charitable_non_cash, salt, mortgage_interest, other_itemized) to four cleaner types:

1. **Charitable Gift** — simple sum for v1. Full AGI caps (60% cash, 30% stock) and 5-year carry-forward deferred to a follow-up spec.
2. **Above Line Deduction** — catch-all, subtracts from gross to get AGI.
3. **Below Line Deduction** — catch-all itemized (replaces `other_itemized`; mortgage interest rolls here).
4. **Property Tax** — contributes to SALT, capped statutorily.

SALT cap updated to reflect OBBBA: $40,000 for tax years 2026+, $10,000 for 2018-2025 (TCJA). The cap is a flat statutory dollar amount — no inflation applied.

Medical expense deduction (with 7.5% AGI threshold) explicitly deferred to a follow-up per user scope decision.

## MVP Scope

**In scope:**
- Enum rename/restructure (v1 → v2 via migration)
- Expense → deduction flow via new `deduction_type` column on expenses
- Mortgage interest deduction from liability amortization (new `is_interest_deductible` flag)
- Real estate property taxes (new fields on accounts; synthetic expense + SALT contribution)
- SALT cap aggregation across all sources (client_deductions + expenses tagged as property_tax + real estate property_tax)
- SALT cap updated: $40k (OBBBA, 2026+) / $10k (TCJA, pre-2026), no inflation
- New "Real Estate Expenses" category in cashflow expense breakdown with drill-down (Property Taxes → per-property, Other RE Expenses placeholder)

**Out of scope (v2 followups):**
- Charitable AGI caps (60% cash / 30% non-cash / 50% mixed)
- Charitable 5-year carry-forward (requires multi-year engine state)
- Cash vs. stock/non-cash charitable distinction (lost in migration; restore in charitable-v2 work)
- Medical expense deduction with 7.5% AGI threshold
- Amortization table tab on liabilities (separate FUTURE_WORK item; pairs with mortgage-interest-deduction since both use amortizeLiability's per-year interest)
- Other RE Expenses sub-items (insurance, HOA, maintenance — placeholder only in this spec)

**Also captured for future** (user's verbal request during brainstorm):
- **Tax drill-down Below Line breakdown** — when we ship the per-year-ledger-drill-in tax engine polish, the Below-Line Deduct cell drill-down should show the new categories (charitable, property tax/SALT, below-line catch-all, mortgage interest auto-derived, and standard deduction portion). This request is captured here so the polish implementer knows the target categories.

## Section 1: Architecture

```
src/db/migrations/0018_deduction_types_v2.sql          CREATE
  - Create new deduction_type_v2 enum
  - Migrate client_deductions.type to the new enum (data preserved)
  - Drop old enum, rename new to deduction_type
  - ALTER expenses ADD deduction_type (nullable)
  - ALTER liabilities ADD is_interest_deductible boolean DEFAULT false
  - ALTER accounts ADD annual_property_tax numeric DEFAULT '0'
  - ALTER accounts ADD property_tax_growth_rate numeric DEFAULT '0.03'

src/db/schema.ts                                        MODIFY
  - Update deductionTypeEnum values
  - Add deductionType column to expenses
  - Add isInterestDeductible to liabilities
  - Add annualPropertyTax + propertyTaxGrowthRate to accounts

src/lib/tax/derive-deductions.ts                        MODIFY (~80 lines added)
  - New: deriveAboveLineFromExpenses(year, expenses) → DeductionContribution
  - New: deriveItemizedFromExpenses(year, expenses) → DeductionContribution
  - New: deriveMortgageInterestFromLiabilities(year, liabilities, interestByLiab) → DeductionContribution
  - New: derivePropertyTaxFromAccounts(year, accounts) → DeductionContribution
  - Modify: SALT cap updated to year-aware ($40k 2026+ / $10k pre-2026), no inflation
  - New: aggregateDeductions(...contributions) → { aboveLine, itemized }
src/lib/tax/__tests__/derive-deductions.test.ts         MODIFY (+~25 tests)

src/engine/liabilities.ts                               MODIFY (~5 lines)
  - Add interestByLiability: Record<string, number> to LiabilitiesResult

src/engine/types.ts                                     MODIFY (~10 lines)
  - Add deductionType to Expense interface
  - Add isInterestDeductible to Liability interface
  - Add annualPropertyTax + propertyTaxGrowthRate to Account interface

src/engine/projection.ts                                MODIFY (~30 lines)
  - Inject synthetic property-tax expense rows at top of year loop
  - Wire all 5 deduction sources via collect-then-cap pattern
  - Add realEstate category to expense breakdown
  - Pass merged aboveLine and itemized into bracket call

src/engine/__tests__/projection.test.ts                 MODIFY (+3 tests)

src/components/forms/
  add-expense-form.tsx                                  MODIFY (+1 select: deductionType)
  add-liability-form.tsx                                MODIFY (+1 checkbox: isInterestDeductible)
  add-account-form.tsx                                  MODIFY (+2 fields when category=real_estate)
  add-deduction-form.tsx                                MODIFY (update enum + labels)

src/components/deductions-derived-summary.tsx            MODIFY (expand to 4 source groups)
src/components/deductions-itemized-list.tsx              MODIFY (update labels)
src/components/cashflow-report.tsx                       MODIFY (add realEstate expense category + drill-down)
```

**Why one shared helper module:** each new auto-derivation path is a small pure function. Keeping them together makes the SALT cap aggregation trivial — collect all contributions, sum per bucket, cap SALT once.

**Why a per-account `propertyTaxGrowthRate`:** property taxes grow at assessment rates that can diverge from CPI (e.g., California Prop 13 caps at 2%; other states can jump 10%+ in reassessment years).

## Section 2: Schema

### Migration `0018_deduction_types_v2.sql`

```sql
-- 1. Create new enum with v2 values
CREATE TYPE "public"."deduction_type_v2" AS ENUM(
  'charitable',
  'above_line',
  'below_line',
  'property_tax'
);
--> statement-breakpoint

-- 2. Migrate client_deductions.type column to the new enum (zero-data-loss)
ALTER TABLE "client_deductions"
  ALTER COLUMN "type" TYPE "deduction_type_v2"
  USING (CASE "type"::text
    WHEN 'charitable_cash'     THEN 'charitable'::deduction_type_v2
    WHEN 'charitable_non_cash' THEN 'charitable'::deduction_type_v2
    WHEN 'salt'                THEN 'property_tax'::deduction_type_v2
    WHEN 'mortgage_interest'   THEN 'below_line'::deduction_type_v2
    WHEN 'other_itemized'      THEN 'below_line'::deduction_type_v2
  END);
--> statement-breakpoint

-- 3. Drop old enum, rename new
DROP TYPE "public"."deduction_type";
--> statement-breakpoint
ALTER TYPE "public"."deduction_type_v2" RENAME TO "deduction_type";
--> statement-breakpoint

-- 4. Add new columns
ALTER TABLE "expenses"
  ADD COLUMN "deduction_type" "deduction_type";
--> statement-breakpoint
ALTER TABLE "liabilities"
  ADD COLUMN "is_interest_deductible" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "accounts"
  ADD COLUMN "annual_property_tax" numeric(15, 2) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "accounts"
  ADD COLUMN "property_tax_growth_rate" numeric(5, 4) NOT NULL DEFAULT '0.03';
```

### Drizzle schema updates

```typescript
export const deductionTypeEnum = pgEnum("deduction_type", [
  "charitable",
  "above_line",
  "below_line",
  "property_tax",
]);

// expenses table
deductionType: deductionTypeEnum("deduction_type"),

// liabilities table
isInterestDeductible: boolean("is_interest_deductible").notNull().default(false),

// accounts table
annualPropertyTax: decimal("annual_property_tax", { precision: 15, scale: 2 }).notNull().default("0"),
propertyTaxGrowthRate: decimal("property_tax_growth_rate", { precision: 5, scale: 4 }).notNull().default("0.03"),
```

### Label map (for UI)

```typescript
const DEDUCTION_TYPE_LABELS: Record<string, string> = {
  charitable: "Charitable Gift",
  above_line: "Above Line Deduction",
  below_line: "Below Line Deduction",
  property_tax: "Property Tax",
};
```

### Migration of existing v1 rows

Any `client_deductions` rows created during earlier testing get deterministic mappings:
- `charitable_cash` / `charitable_non_cash` → `charitable` (cash/non-cash distinction lost — will be restored in the charitable-v2 carry-forward work)
- `salt` → `property_tax`
- `mortgage_interest` → `below_line` (user re-enters as a liability flag)
- `other_itemized` → `below_line`

## Section 3: Engine Integration

### Contribution interface

All deduction helpers return a structured contribution object so aggregation and SALT capping happen in one place:

```typescript
export interface DeductionContribution {
  aboveLine: number;
  itemized: number;
  saltPool: number;
}

const EMPTY_CONTRIBUTION: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 0 };
```

### SALT cap (year-aware, no inflation)

```typescript
export function saltCap(year: number): number {
  return year >= 2026 ? 40_000 : 10_000;
}
```

The cap is a flat statutory dollar amount. No inflation is applied — it changes only when Congress acts.

### New helpers in `derive-deductions.ts`

All pure functions, no DB or React imports.

**`deriveAboveLineFromExpenses(year, expenses)`** — sums expenses tagged with `deductionType: "above_line"` that are active in the given year. Returns `{ aboveLine: amount, itemized: 0, saltPool: 0 }`.

**`deriveItemizedFromExpenses(year, expenses)`** — sums expenses by their `deductionType`:
- `charitable` → `itemized`
- `below_line` → `itemized`
- `property_tax` → `saltPool`
- `above_line` and untagged → skipped (handled by the above-line helper or not a deduction)

Returns `{ aboveLine: 0, itemized, saltPool }`.

**`deriveMortgageInterestFromLiabilities(year, liabilities, interestByLiability)`** — filters liabilities where `isInterestDeductible === true` and active in the year, looks up the interest portion from the `interestByLiability` map (already computed by `computeLiabilities`), sums. Returns `{ aboveLine: 0, itemized: interest, saltPool: 0 }`.

**`derivePropertyTaxFromAccounts(year, accounts, planStartYear)`** — for each `real_estate` account with `annualPropertyTax > 0`, inflates the amount by `propertyTaxGrowthRate` from `planStartYear` (i.e., `annualPropertyTax * (1 + growthRate) ^ (year - planStartYear)`). Returns `{ aboveLine: 0, itemized: 0, saltPool: inflatedTotal }`.

### Modified: `sumItemizedFromEntries` (v2)

The existing function still handles manual `client_deductions` rows, but now returns a `DeductionContribution` instead of a flat number:
- `charitable` rows → `itemized`
- `above_line` rows → `aboveLine`
- `below_line` rows → `itemized`
- `property_tax` rows → `saltPool`

Growth/inflation logic unchanged. Year-range filter unchanged.

### Aggregation function

```typescript
export function aggregateDeductions(
  year: number,
  ...contributions: DeductionContribution[]
): { aboveLine: number; itemized: number } {
  let aboveLine = 0;
  let itemized = 0;
  let salt = 0;

  for (const c of contributions) {
    aboveLine += c.aboveLine;
    itemized += c.itemized;
    salt += c.saltPool;
  }

  // Statutory cap — no inflation
  const cappedSalt = Math.min(salt, saltCap(year));
  return { aboveLine, itemized: itemized + cappedSalt };
}
```

### `liabilities.ts` change

Add `interestByLiability: Record<string, number>` to `LiabilitiesResult`. Inside `computeLiabilities`, capture the already-computed `interestPortion` per liability:

```typescript
interestByLiability[liab.id] = result.interestPortion;
```

### `projection.ts` integration

The year loop changes:

**Step 1 — Inject synthetic property-tax expenses:**
At the top of the year loop, before `computeExpenses()`, create synthetic expense rows for each real estate account with `annualPropertyTax > 0`. These get a `type: "other"`, a name like `"Property Tax – {accountName}"`, and the inflated amount for the year. They are added to the expenses array passed to `computeExpenses()` so they flow through `expenses.bySource` keyed by account ID.

**Step 2 — Expense breakdown gains `realEstate` category:**
The `ProjectionYear.expenses` object adds a `realEstate` field. Synthetic property-tax expenses are summed into this category. The cashflow report renders a "Real Estate Expenses" row with drill-down:
```
Real Estate Expenses: $18,000
  └─ Property Taxes: $18,000
       ├─ 123 Main St: $12,000
       └─ Beach House: $6,000
  └─ Other RE Expenses: $0
       (placeholder for future: insurance, HOA, maintenance)
```

**Step 3 — Collect deduction contributions (collect-then-cap):**
```typescript
const contributions = [
  deriveAboveLineFromSavings(year, savingsRules, accounts, isGrantorEntity),
  deriveAboveLineFromExpenses(year, expenses),
  deriveItemizedFromExpenses(year, expenses),
  deriveMortgageInterestFromLiabilities(year, liabilities, liabResult.interestByLiability),
  derivePropertyTaxFromAccounts(year, accounts, planSettings.planStartYear),
  sumItemizedFromEntries(year, data.deductions ?? []),
];
const { aboveLine, itemized } = aggregateDeductions(year, ...contributions);
```

Note: `deriveAboveLineFromSavings` return type changes from `number` to `DeductionContribution` (returns `{ aboveLine: amount, itemized: 0, saltPool: 0 }`).

**Step 4 — Pass to bracket call:**
```typescript
aboveLineDeductions: aboveLine,
itemizedDeductions: itemized,
```

### Behavioral notes

- Below-line behavior unchanged — `calculate.ts` already does `max(stdDeduction, itemizedDeductions)`
- Bracket mode opt-in still applies — flat shim ignores deductions
- Synthetic property-tax expenses show up in `expenses.bySource` keyed by the real estate account ID, so the account ledger for that property shows the tax outflow
- Synthetic expenses are NOT persisted to the `expenses` table — they exist only at projection time
- Non-grantor entity savings/accounts excluded from household deductions (unchanged from v1)

## Section 4: UI Changes

### Expense form — `deductionType` select

Always visible on the add/edit expense form. A "Tax Treatment" dropdown below the existing fields:
- Default: `None` (null — not a deduction)
- Options: None, Charitable Gift, Above Line Deduction, Below Line Deduction, Property Tax
- Uses the `DEDUCTION_TYPE_LABELS` map for display

### Liability form — `isInterestDeductible` checkbox

Visible for all liability types (not just mortgages — home equity loans and business loans can also have deductible interest):
- Checkbox label: "Interest is tax-deductible"
- Helper text: "When checked, the annual interest portion flows into your itemized deductions (e.g., mortgage interest)."

### Account form — real estate fields

Conditionally rendered when `category === "real_estate"`. Two fields appear under a "Real Estate Details" subheading:
- "Annual Property Tax" — currency input, default $0
- "Property Tax Growth Rate" — percentage input, default 3%

### Deduction form — enum update

`add-deduction-form.tsx` type select updated from the v1 five types to the v2 four types using `DEDUCTION_TYPE_LABELS`. Existing form structure unchanged.

### Deductions page — expanded auto-derived summary

`deductions-derived-summary.tsx` expands from one section (savings-derived) to four source groups:

**Auto-derived from your savings (above-line)**
- Lists each savings rule whose account is traditional IRA or 401k (unchanged from v1)

**Auto-derived from your expenses**
- Lists each expense with a `deductionType` set, grouped by type (charitable, above-line, below-line, property tax)
- Helpful link: "Edit on the Income & Expenses tab"

**Auto-derived from your mortgages (below-line)**
- Lists each liability with `isInterestDeductible: true`, showing the estimated annual interest for the current year
- Helpful link: "Edit on the Liabilities tab"

**Auto-derived from your real estate (SALT)**
- Lists each real estate account with `annualPropertyTax > 0`, showing the current-year inflated amount
- Helpful link: "Edit on the Balance Sheet"

**Footer totals:**
- Total above-line for [year]: $X
- Total itemized for [year]: $X (of which SALT: $Y, capped at $40,000)
- vs Standard deduction: $Z — indicator showing which the engine will use

### Deductions itemized list — label update

`deductions-itemized-list.tsx` updates type labels from v1 names to v2 `DEDUCTION_TYPE_LABELS`. SALT cap warning text updates from "$10,000 (TCJA)" to "$40,000 (OBBBA)" for manual `property_tax` rows.

### Cashflow report — Real Estate Expenses

`cashflow-report.tsx` adds a `realEstate` row to the expense breakdown. Drill-down hierarchy:
- **Real Estate Expenses** (total)
  - **Property Taxes** (sum of synthetic property-tax expenses)
    - Per-property rows (keyed by account ID/name)
  - **Other RE Expenses** ($0 placeholder — future: insurance, HOA, maintenance)

## Section 5: Testing

### Unit tests — `derive-deductions.test.ts` additions (~25 tests)

**`deriveAboveLineFromExpenses`** (~4 tests):
- Expense tagged `above_line` in range → summed
- Expense tagged `charitable` → excluded (not above-line)
- Expense outside year range → excluded
- No tagged expenses → 0

**`deriveItemizedFromExpenses`** (~5 tests):
- Expense tagged `charitable` → returned as itemized
- Expense tagged `below_line` → returned as itemized
- Expense tagged `property_tax` → returned in saltPool, not itemized
- Mixed tagged expenses → correct bucket separation
- Growth rate applied correctly from expense's inflationStartYear

**`deriveMortgageInterestFromLiabilities`** (~4 tests):
- Liability with `isInterestDeductible: true` → interest portion returned
- Liability with `isInterestDeductible: false` → excluded
- Liability outside year range → 0
- Multiple deductible liabilities → summed

**`derivePropertyTaxFromAccounts`** (~4 tests):
- Real estate account with property tax → inflated amount returned in saltPool
- Non-real-estate account → excluded
- Growth rate applied correctly year-over-year
- Zero property tax → excluded

**SALT cap aggregation** (~5 tests):
- All sources under cap → full amount
- All sources over $40k cap (2026+) → capped at $40k
- Pre-2026 year → capped at $10k
- No inflation on cap value itself (same cap applied regardless of year distance from 2026)
- Mixed sources (manual `property_tax` deduction + expense-tagged + account property tax) all pool before single cap

**`sumItemizedFromEntries` v2** (~3 tests):
- `above_line` row → returned in aboveLine bucket
- `property_tax` row → returned in saltPool bucket
- Existing tests updated for `DeductionContribution` return type

### Engine integration — `projection.test.ts` additions (~3 tests)

- Bracket-mode client with `isInterestDeductible` mortgage → interest portion reduces taxable income via itemized deductions
- Bracket-mode client with real estate `annualPropertyTax` → shows in SALT pool (capped), and appears in `expenses.realEstate` breakdown
- Bracket-mode client with expense tagged `charitable` → flows into itemized deductions

### No React component tests

No RTL setup. Manual smoke covers UI.

### Manual smoke test checklist

1. Migration runs cleanly; new columns exist; `client_deductions` rows migrated to v2 enum
2. Add expense with `deductionType: "charitable"` → appears in auto-derived summary, tax recalculates
3. Toggle `isInterestDeductible` on a mortgage → interest appears in derived summary, tax recalculates
4. Add `annualPropertyTax: $12,000` on a real estate account → synthetic expense appears in cashflow "Real Estate Expenses" row with drill-down to per-property
5. SALT cap shown correctly ($40k for 2026+)
6. Multiple SALT sources (manual property_tax deduction + expense-tagged + account) → aggregate before single cap
7. Existing manual `client_deductions` rows display with new enum labels
8. Deduction form shows v2 type options
9. `npm test` — all existing + ~25 new helper tests + 3 integration tests pass
10. Flat-mode regression: deductions computed but taxes still use flat rate

### Edge cases

- Client with no tagged expenses, no deductible liabilities, no real estate → all new helpers return zero, behavior identical to v1
- Liability past its end year → `isInterestDeductible` ignored (interest portion is already 0)
- Real estate account with $0 property tax → no synthetic expense injected
- Expense tagged `property_tax` with amount > SALT cap → pooled and capped correctly

## Followup Items to Track (user-requested during brainstorm)

- **Charitable v2** — cash vs non-cash distinction, 60%/30% AGI caps, 5-year carry-forward. Significant engine state change.
- **Medical expense deduction** — 7.5% AGI threshold. Interacts with AGI recursion; needs careful ordering.
- **Below-line drill-down breakdown** — when the per-year ledger drill-in ships, the Below Line Deduct cell should break down by charitable, property tax/SALT, below-line catch-all, mortgage interest auto-derived, and standard deduction portion. Captured here so the polish implementer knows the target categories.
- **Other RE Expenses** — insurance, HOA, maintenance, etc. as additional sub-items under the Real Estate Expenses cashflow category. Placeholder exists in the drill-down structure.
