# Auto-Derived Deductions — Design Spec (PARTIAL — IN PROGRESS)

**Date:** 2026-04-16
**Status:** In progress — sections 1-2 locked, 3-5 TBD
**Depends on:** Deduction types foundation (shipped as `b40983c`)

## Resumption Note

Brainstorming paused mid-flow. The next time this is picked up:

1. Re-open this spec and confirm sections 1-2 still look right
2. Continue brainstorming from **Section 3 (Engine integration)** through Section 4 (UI) and Section 5 (Testing)
3. Write the implementation plan
4. Execute via subagent-driven-development

Worktree: `/Users/danmueller/Desktop/foundry-planning-auto-deductions` on `feat/auto-derived-deductions`.

## Overview

Auto-derive deductions from data advisors already enter elsewhere, reducing duplicate entry and making the tax engine more accurate out-of-the-box:

1. **Expenses → deductions** — a new `deduction_type` select on expense rows. When set, the expense's annual amount flows into the engine as that deduction type.
2. **Mortgage interest → below-line deduction** — a new `is_interest_deductible` checkbox on liabilities. When checked, the year's interest portion (already computed by `amortizeLiability`) counts as a below-line deduction.
3. **Property taxes on real estate** — a new `annual_property_tax` + `property_tax_growth_rate` on accounts. Engine synthesizes a year-by-year expense line and contributes the amount to SALT (property tax).

Also renames the deduction type enum from the v1 five types (charitable_cash, charitable_non_cash, salt, mortgage_interest, other_itemized) to four cleaner types:

1. **Charitable Gift** — simple sum for v1. Full AGI caps (60% cash, 30% stock) and 5-year carry-forward deferred to a follow-up spec.
2. **Above Line Deduction** — catch-all, subtracts from gross to get AGI.
3. **Below Line Deduction** — catch-all itemized (replaces `other_itemized`; mortgage interest rolls here).
4. **Property Tax** — contributes to SALT, capped at $10k statutorily.

Medical expense deduction (with 7.5% AGI threshold) explicitly deferred to a follow-up per user scope decision (option C).

## MVP Scope

**In scope:**
- Enum rename/restructure (v1 → v2 via migration)
- Expense → deduction flow via new `deduction_type` column on expenses
- Mortgage interest deduction from liability amortization (new `is_interest_deductible` flag)
- Real estate property taxes (new fields on accounts; synthetic expense + SALT contribution)
- SALT cap aggregation across all sources (client_deductions + expenses tagged as property_tax + real estate property_tax)

**Out of scope (v2 followups):**
- Charitable AGI caps (60% cash / 30% non-cash / 50% mixed)
- Charitable 5-year carry-forward (requires multi-year engine state)
- Cash vs. stock/non-cash charitable distinction (lost in migration; restore in charitable-v2 work)
- Medical expense deduction with 7.5% AGI threshold
- Amortization table tab on liabilities (separate FUTURE_WORK item; pairs with mortgage-interest-deduction since both use amortizeLiability's per-year interest)

**Also captured for future** (user's verbal request during this brainstorm):
- **Tax drill-down Below Line breakdown** — when we ship the per-year-ledger-drill-in tax engine polish, the Below-Line Deduct cell drill-down should show the new categories (charitable, property tax/SALT, below-line catch-all, mortgage interest, standard deduction portion). This request is captured here so the polish implementer knows the target categories.

## Section 1: Architecture — LOCKED

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

src/lib/tax/derive-deductions.ts                        MODIFY (~50 lines added)
  - New: deriveItemizedFromExpenses(year, expenses) → contributions
  - New: deriveAboveLineFromExpenses(year, expenses) → number
  - New: deriveMortgageInterestFromLiabilities(year, liabilities, amortizationCache) → number
  - New: derivePropertyTaxesFromAccounts(year, accounts) → contributions + synthetic expenses
  - Modify sumItemizedFromEntries to accept merged contributions and cap SALT from all sources together
src/lib/tax/__tests__/derive-deductions.test.ts         MODIFY (+~25 tests)

src/engine/projection.ts                                MODIFY (~15 lines)
  - Wire new helpers; pass merged itemized + above-line into bracket call
  - Inject synthetic property-tax expenses into the year's expense breakdown

src/components/forms/
  add-expense-form.tsx                                  MODIFY (+1 select: deductionType)
  add-liability-form.tsx                                MODIFY (+1 checkbox: isInterestDeductible)
  add-account-form.tsx                                  MODIFY (+2 fields when category=real_estate)
  add-deduction-form.tsx                                MODIFY (update enum + labels)

src/components/deductions-itemized-list.tsx             MODIFY (update labels)
```

**Why one shared helper module:** each new auto-derivation path is a small pure function. Keeping them together makes the SALT cap aggregation trivial — collect all property-tax contributions from any source, sum, cap at $10k, then add to non-SALT itemized.

**Why a per-account `propertyTaxGrowthRate`:** property taxes grow at assessment rates that can diverge from CPI (e.g., California Prop 13 caps at 2%; other states can jump 10%+ in reassessment years).

## Section 2: Schema — LOCKED

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

Any `client_deductions` rows created during yesterday's smoke test get deterministic mappings:
- `charitable_cash` / `charitable_non_cash` → `charitable` (cash/non-cash distinction lost — will be restored in the charitable-v2 carry-forward work)
- `salt` → `property_tax`
- `mortgage_interest` → `below_line` (user re-enters as a liability flag)
- `other_itemized` → `below_line`

## Section 3: Engine integration — TBD

_When resuming: discuss how the five helpers (client_deductions, expenses→deductions, mortgage interest from liabilities, property tax from accounts, plus existing savings→above_line) aggregate through the SALT cap. Detailed pseudo-code for sumItemizedFromEntries v2. How synthetic property-tax expenses get injected into the year's expense breakdown without breaking existing cashflow categories._

## Section 4: UI changes — TBD

_When resuming: details on form changes for add-expense, add-liability, add-account (real estate fields), add-deduction (new enum labels), and deductions-itemized-list (updated labels + new "Auto-derived from real estate / mortgages / expenses" sections in the derived summary)._

## Section 5: Testing — TBD

_When resuming: enumerate tests for each new helper (enough coverage for the cap aggregation logic), engine integration tests (mortgage-interest + property-tax end-to-end), and manual smoke test checklist._

## Followup Items to Track (user-requested during brainstorm)

- **Charitable v2** — cash vs non-cash distinction, 60%/30% AGI caps, 5-year carry-forward. Significant engine state change.
- **Medical expense deduction** — 7.5% AGI threshold. Interacts with AGI recursion; needs careful ordering.
- **Below-line drill-down breakdown** — when the per-year ledger drill-in ships, the Below Line Deduct cell should break down by charitable, property tax/SALT, below-line catch-all, mortgage interest auto-derived, and standard deduction portion. Captured here so the polish implementer knows the target categories.
