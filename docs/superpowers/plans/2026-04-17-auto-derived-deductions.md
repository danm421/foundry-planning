# Auto-Derived Deductions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-derive deductions from expenses, mortgage interest, and real estate property taxes — reducing duplicate data entry and feeding real numbers into the bracket tax engine's above-line and itemized deduction slots.

**Architecture:** New `DeductionContribution` interface unifies all deduction sources into `{ aboveLine, itemized, saltPool }` buckets. Four new pure helpers in `derive-deductions.ts` collect contributions from expenses, liabilities, and accounts. `projection.ts` aggregates all contributions and applies the SALT cap ($40k OBBBA 2026+ / $10k TCJA pre-2026, no inflation) once. Synthetic property-tax expense rows are injected at projection time for cashflow reporting. Migration 0018 restructures the deduction enum from 5 v1 types to 4 v2 types and adds columns to expenses, liabilities, and accounts.

**Tech Stack:** TypeScript, Next.js 16, Drizzle ORM, Postgres (Neon), React 19, vitest.

**Spec:** [docs/superpowers/specs/2026-04-16-auto-derived-deductions-design.md](../specs/2026-04-16-auto-derived-deductions-design.md)

---

## File Structure

```
src/db/migrations/0018_deduction_types_v2.sql           CREATE
src/db/migrations/meta/_journal.json                    MODIFY (idx 18)
src/db/schema.ts                                        MODIFY (enum, 3 table alterations)

src/lib/tax/derive-deductions.ts                        MODIFY (~80 lines added)
src/lib/tax/__tests__/derive-deductions.test.ts         MODIFY (~25 tests added)

src/engine/types.ts                                     MODIFY (~8 lines)
src/engine/liabilities.ts                               MODIFY (~3 lines)
src/engine/projection.ts                                MODIFY (~35 lines)
src/engine/__tests__/fixtures.ts                        MODIFY (~15 lines)
src/engine/__tests__/projection.test.ts                 MODIFY (~3 tests)

src/app/api/clients/[id]/expenses/route.ts              MODIFY (~2 lines)
src/app/api/clients/[id]/expenses/[expenseId]/route.ts  MODIFY (~2 lines)
src/app/api/clients/[id]/liabilities/route.ts           MODIFY (~2 lines)
src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts MODIFY (~2 lines)
src/app/api/clients/[id]/accounts/route.ts              MODIFY (~2 lines)
src/app/api/clients/[id]/projection-data/route.ts       MODIFY (~10 lines)

src/components/income-expenses-view.tsx                 MODIFY (~15 lines)
src/components/forms/add-liability-form.tsx              MODIFY (~15 lines)
src/components/forms/add-account-form.tsx                MODIFY (~20 lines)
src/components/forms/add-deduction-form.tsx              MODIFY (~15 lines)
src/components/deductions-derived-summary.tsx            MODIFY (~100 lines added)
src/components/deductions-itemized-list.tsx              MODIFY (~5 lines)
src/components/cashflow-report.tsx                       MODIFY (~20 lines)

src/app/(app)/clients/[id]/client-data/deductions/
  page.tsx                                              MODIFY (~15 lines)
  deductions-client.tsx                                 MODIFY (~20 lines)
```

---

## Task 1: Migration 0018 — enum restructure + new columns

**Files:**
- Create: `src/db/migrations/0018_deduction_types_v2.sql`
- Modify: `src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Create migration file**

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

-- 4. Add deduction_type to expenses (nullable — most expenses are not deductions)
ALTER TABLE "expenses"
  ADD COLUMN "deduction_type" "deduction_type";
--> statement-breakpoint

-- 5. Add is_interest_deductible to liabilities
ALTER TABLE "liabilities"
  ADD COLUMN "is_interest_deductible" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- 6. Add property tax fields to accounts
ALTER TABLE "accounts"
  ADD COLUMN "annual_property_tax" numeric(15, 2) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "accounts"
  ADD COLUMN "property_tax_growth_rate" numeric(5, 4) NOT NULL DEFAULT '0.03';
```

Write this to `src/db/migrations/0018_deduction_types_v2.sql`.

- [ ] **Step 2: Update migration journal**

In `src/db/migrations/meta/_journal.json`, add to the `entries` array after the idx 17 entry:

```json
{
  "idx": 18,
  "version": "7",
  "when": 1777168300000,
  "tag": "0018_deduction_types_v2",
  "breakpoints": true
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/0018_deduction_types_v2.sql src/db/migrations/meta/_journal.json
git commit -m "feat(deductions): add migration 0018 — enum restructure + new columns"
```

---

## Task 2: Update Drizzle schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Update deductionTypeEnum**

Replace the existing enum definition (around line 136):

```typescript
// OLD:
export const deductionTypeEnum = pgEnum("deduction_type", [
  "charitable_cash",
  "charitable_non_cash",
  "salt",
  "mortgage_interest",
  "other_itemized",
]);

// NEW:
export const deductionTypeEnum = pgEnum("deduction_type", [
  "charitable",
  "above_line",
  "below_line",
  "property_tax",
]);
```

- [ ] **Step 2: Add deductionType to expenses table**

In the `expenses` table definition (around line 395-428), add after the `cashAccountId` column and before `source`:

```typescript
  deductionType: deductionTypeEnum("deduction_type"),
```

- [ ] **Step 3: Add isInterestDeductible to liabilities table**

In the `liabilities` table definition (around line 430-460), add after `ownerEntityId` and before `createdAt`:

```typescript
  isInterestDeductible: boolean("is_interest_deductible").notNull().default(false),
```

- [ ] **Step 4: Add property tax fields to accounts table**

In the `accounts` table definition (around line 313-351), add after `overridePctTaxExempt` and before `source`:

```typescript
  annualPropertyTax: decimal("annual_property_tax", { precision: 15, scale: 2 }).notNull().default("0"),
  propertyTaxGrowthRate: decimal("property_tax_growth_rate", { precision: 5, scale: 4 }).notNull().default("0.03"),
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Clean compile (the v1 enum values referenced in add-deduction-form.tsx and deductions-itemized-list.tsx will fail — that's expected and fixed in Tasks 10-11).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(deductions): update Drizzle schema with v2 enum + new columns"
```

---

## Task 3: Apply migration to dev DB

**Files:** None (DB operation only)

- [ ] **Step 1: Run migration**

```bash
npx drizzle-kit migrate
```

Expected: Migration 0018 applies cleanly. Existing `client_deductions` rows (if any) are migrated to the v2 enum values.

- [ ] **Step 2: Verify**

```bash
npx drizzle-kit studio
```

Check: `client_deductions.type` column uses v2 values, `expenses` has `deduction_type` column, `liabilities` has `is_interest_deductible`, `accounts` has `annual_property_tax` and `property_tax_growth_rate`.

---

## Task 4: Update engine types

**Files:**
- Modify: `src/engine/types.ts`

- [ ] **Step 1: Add deductionType to Expense interface**

In the `Expense` interface (around line 90-103), add after `cashAccountId`:

```typescript
  deductionType?: "charitable" | "above_line" | "below_line" | "property_tax" | null;
```

- [ ] **Step 2: Add isInterestDeductible to Liability interface**

In the `Liability` interface (around line 105-115), add after `ownerEntityId`:

```typescript
  isInterestDeductible?: boolean;
```

- [ ] **Step 3: Add property tax fields to Account interface**

In the `Account` interface (around line 44-64), add after `isDefaultChecking`:

```typescript
  annualPropertyTax?: number;
  propertyTaxGrowthRate?: number;
```

- [ ] **Step 4: Add realEstate to ProjectionYear expenses**

In the `ProjectionYear.expenses` object (around line 187-195), add after `insurance`:

```typescript
    realEstate: number;
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Clean (or expected failures in UI files using old enum values — those are fixed later).

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(deductions): extend engine types with deduction/property-tax fields"
```

---

## Task 5: Expose interestByLiability from liabilities.ts

**Files:**
- Modify: `src/engine/liabilities.ts`

- [ ] **Step 1: Add interestByLiability to LiabilitiesResult**

Update the `LiabilitiesResult` interface (line 10-14):

```typescript
// OLD:
interface LiabilitiesResult {
  totalPayment: number;
  updatedLiabilities: Liability[];
  byLiability: Record<string, number>;
}

// NEW:
interface LiabilitiesResult {
  totalPayment: number;
  updatedLiabilities: Liability[];
  byLiability: Record<string, number>;
  interestByLiability: Record<string, number>;
}
```

- [ ] **Step 2: Populate interestByLiability in computeLiabilities**

In `computeLiabilities` (line 36-56), add a new `interestByLiability` accumulator and populate it:

```typescript
export function computeLiabilities(
  liabilities: Liability[],
  year: number,
  filter?: (liab: Liability) => boolean
): LiabilitiesResult {
  let totalPayment = 0;
  const updatedLiabilities: Liability[] = [];
  const byLiability: Record<string, number> = {};
  const interestByLiability: Record<string, number> = {};

  for (const liab of liabilities) {
    const result = amortizeLiability(liab, year);
    updatedLiabilities.push({ ...liab, balance: result.endingBalance });
    byLiability[liab.id] = result.annualPayment;
    interestByLiability[liab.id] = result.interestPortion;
    if (filter && !filter(liab)) continue;
    totalPayment += result.annualPayment;
  }

  return { totalPayment, updatedLiabilities, byLiability, interestByLiability };
}
```

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run src/engine/__tests__/liabilities.test.ts`

Expected: All existing tests pass (the new field doesn't affect existing behavior).

- [ ] **Step 4: Commit**

```bash
git add src/engine/liabilities.ts
git commit -m "feat(deductions): expose interestByLiability from computeLiabilities"
```

---

## Task 6: Refactor derive-deductions.ts — DeductionContribution + new helpers (TDD)

**Files:**
- Modify: `src/lib/tax/derive-deductions.ts`
- Modify: `src/lib/tax/__tests__/derive-deductions.test.ts`

This is the largest task. It introduces the `DeductionContribution` interface, refactors existing functions to use it, adds four new helpers, and adds the aggregation function.

- [ ] **Step 1: Write failing tests for DeductionContribution refactor**

Add these imports at the top of `derive-deductions.test.ts`:

```typescript
import {
  deriveAboveLineFromSavings,
  sumItemizedFromEntries,
  deriveAboveLineFromExpenses,
  deriveItemizedFromExpenses,
  deriveMortgageInterestFromLiabilities,
  derivePropertyTaxFromAccounts,
  aggregateDeductions,
  saltCap,
  type SavingsRuleForDeduction,
  type AccountForDeduction,
  type ClientDeductionRow,
  type DeductionContribution,
  type ExpenseForDeduction,
  type LiabilityForDeduction,
  type AccountForPropertyTax,
} from "../derive-deductions";
```

Replace the existing `describe("deriveAboveLineFromSavings"` tests to use `.aboveLine` accessor (the function now returns `DeductionContribution`). For example, the first test becomes:

```typescript
it("sums traditional IRA contributions", () => {
  const rules = [makeRule("acct-ira", 7500)];
  const result = deriveAboveLineFromSavings(2026, rules, [ACCT_TRADITIONAL_IRA], isGrantorAlways);
  expect(result.aboveLine).toBe(7500);
  expect(result.itemized).toBe(0);
  expect(result.saltPool).toBe(0);
});
```

Update ALL existing `deriveAboveLineFromSavings` tests to use `result.aboveLine` instead of the bare return value.

Replace the existing `describe("sumItemizedFromEntries"` tests similarly. Update `makeRow` type values from v1 (`"charitable_cash"`, `"salt"`, etc.) to v2 (`"charitable"`, `"property_tax"`, etc.). The function now returns `DeductionContribution`, so tests access `.itemized` and `.saltPool`:

```typescript
function makeRow(type: ClientDeductionRow["type"], amount: number, growth = 0, startYear = 2026, endYear = 2076): ClientDeductionRow {
  return { type, annualAmount: amount, growthRate: growth, startYear, endYear };
}

describe("sumItemizedFromEntries", () => {
  it("returns zero contribution for empty rows", () => {
    const result = sumItemizedFromEntries(2026, []);
    expect(result.aboveLine).toBe(0);
    expect(result.itemized).toBe(0);
    expect(result.saltPool).toBe(0);
  });

  it("sums a charitable row into itemized", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("charitable", 25000)]);
    expect(result.itemized).toBe(25000);
    expect(result.saltPool).toBe(0);
  });

  it("inflates a charitable row by growth rate", () => {
    const result = sumItemizedFromEntries(2030, [makeRow("charitable", 25000, 0.02)]);
    expect(result.itemized).toBeCloseTo(27060.8, 1);
  });

  it("routes property_tax rows to saltPool", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("property_tax", 15000)]);
    expect(result.saltPool).toBe(15000);
    expect(result.itemized).toBe(0);
  });

  it("routes above_line rows to aboveLine", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("above_line", 5000)]);
    expect(result.aboveLine).toBe(5000);
    expect(result.itemized).toBe(0);
  });

  it("routes below_line rows to itemized", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("below_line", 8000)]);
    expect(result.itemized).toBe(8000);
  });

  it("excludes pre-startYear rows", () => {
    const result = sumItemizedFromEntries(2026, [makeRow("charitable", 25000, 0, 2030, 2076)]);
    expect(result.itemized).toBe(0);
  });

  it("excludes post-endYear rows", () => {
    const result = sumItemizedFromEntries(2031, [makeRow("charitable", 25000, 0, 2026, 2030)]);
    expect(result.itemized).toBe(0);
  });

  it("computes growth independently per row", () => {
    const rows = [makeRow("charitable", 10000, 0.05, 2026), makeRow("charitable", 5000, 0.03, 2028)];
    const result = sumItemizedFromEntries(2030, rows);
    expect(result.itemized).toBeCloseTo(12155.0625 + 5304.5, 2);
  });
});
```

- [ ] **Step 2: Write failing tests for new helpers**

Add these new test sections after the existing ones:

```typescript
// ── Expense deduction helpers ────────────────────────────────────────────────

function makeExpense(
  deductionType: ExpenseForDeduction["deductionType"],
  amount: number,
  startYear = 2026,
  endYear = 2076,
  growthRate = 0,
  inflationStartYear?: number,
): ExpenseForDeduction {
  return { deductionType, annualAmount: amount, startYear, endYear, growthRate, inflationStartYear };
}

describe("deriveAboveLineFromExpenses", () => {
  it("sums expenses tagged above_line", () => {
    const result = deriveAboveLineFromExpenses(2026, [makeExpense("above_line", 5000)]);
    expect(result.aboveLine).toBe(5000);
  });

  it("excludes expenses tagged charitable", () => {
    const result = deriveAboveLineFromExpenses(2026, [makeExpense("charitable", 10000)]);
    expect(result.aboveLine).toBe(0);
  });

  it("excludes expenses outside year range", () => {
    const result = deriveAboveLineFromExpenses(2025, [makeExpense("above_line", 5000)]);
    expect(result.aboveLine).toBe(0);
  });

  it("returns zero for no tagged expenses", () => {
    const result = deriveAboveLineFromExpenses(2026, [makeExpense(null, 10000)]);
    expect(result.aboveLine).toBe(0);
  });
});

describe("deriveItemizedFromExpenses", () => {
  it("routes charitable to itemized", () => {
    const result = deriveItemizedFromExpenses(2026, [makeExpense("charitable", 12000)]);
    expect(result.itemized).toBe(12000);
    expect(result.saltPool).toBe(0);
  });

  it("routes below_line to itemized", () => {
    const result = deriveItemizedFromExpenses(2026, [makeExpense("below_line", 8000)]);
    expect(result.itemized).toBe(8000);
  });

  it("routes property_tax to saltPool", () => {
    const result = deriveItemizedFromExpenses(2026, [makeExpense("property_tax", 3000)]);
    expect(result.saltPool).toBe(3000);
    expect(result.itemized).toBe(0);
  });

  it("separates mixed tagged expenses into correct buckets", () => {
    const exps = [
      makeExpense("charitable", 10000),
      makeExpense("property_tax", 5000),
      makeExpense("below_line", 3000),
    ];
    const result = deriveItemizedFromExpenses(2026, exps);
    expect(result.itemized).toBe(13000);
    expect(result.saltPool).toBe(5000);
  });

  it("applies growth rate from inflationStartYear", () => {
    // $10k, 3% growth, inflationStartYear=2024, year=2026 → 2 years of growth
    // 10000 * 1.03^2 = 10609
    const result = deriveItemizedFromExpenses(2026, [makeExpense("charitable", 10000, 2026, 2076, 0.03, 2024)]);
    expect(result.itemized).toBeCloseTo(10609, 0);
  });
});

// ── Mortgage interest helper ────────────────────────────────────────────────

function makeLiab(
  id: string,
  isInterestDeductible: boolean,
  startYear = 2026,
  endYear = 2056,
): LiabilityForDeduction {
  return { id, isInterestDeductible, startYear, endYear };
}

describe("deriveMortgageInterestFromLiabilities", () => {
  it("includes interest from deductible liabilities", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2026,
      [makeLiab("liab-1", true)],
      { "liab-1": 18000 },
    );
    expect(result.itemized).toBe(18000);
  });

  it("excludes non-deductible liabilities", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2026,
      [makeLiab("liab-1", false)],
      { "liab-1": 18000 },
    );
    expect(result.itemized).toBe(0);
  });

  it("excludes liabilities outside year range", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2025,
      [makeLiab("liab-1", true)],
      { "liab-1": 18000 },
    );
    expect(result.itemized).toBe(0);
  });

  it("sums multiple deductible liabilities", () => {
    const result = deriveMortgageInterestFromLiabilities(
      2026,
      [makeLiab("liab-1", true), makeLiab("liab-2", true)],
      { "liab-1": 18000, "liab-2": 5000 },
    );
    expect(result.itemized).toBe(23000);
  });
});

// ── Property tax from accounts ──────────────────────────────────────────────

function makeREAccount(
  id: string,
  annualPropertyTax: number,
  growthRate = 0.03,
  category: "real_estate" | "taxable" = "real_estate",
): AccountForPropertyTax {
  return { id, name: `Property ${id}`, category, annualPropertyTax, propertyTaxGrowthRate: growthRate };
}

describe("derivePropertyTaxFromAccounts", () => {
  it("returns inflated property tax for real estate accounts", () => {
    const result = derivePropertyTaxFromAccounts(2026, [makeREAccount("re-1", 12000)], 2026);
    expect(result.saltPool).toBe(12000);
  });

  it("excludes non-real-estate accounts", () => {
    const result = derivePropertyTaxFromAccounts(2026, [makeREAccount("brk", 5000, 0.03, "taxable")], 2026);
    expect(result.saltPool).toBe(0);
  });

  it("applies growth rate year-over-year from planStartYear", () => {
    // 12000 * 1.03^2 = 12727.08
    const result = derivePropertyTaxFromAccounts(2028, [makeREAccount("re-1", 12000, 0.03)], 2026);
    expect(result.saltPool).toBeCloseTo(12727.08, 0);
  });

  it("excludes accounts with zero property tax", () => {
    const result = derivePropertyTaxFromAccounts(2026, [makeREAccount("re-1", 0)], 2026);
    expect(result.saltPool).toBe(0);
  });
});

// ── SALT cap + aggregation ──────────────────────────────────────────────────

describe("saltCap", () => {
  it("returns 40000 for 2026+", () => {
    expect(saltCap(2026)).toBe(40000);
    expect(saltCap(2030)).toBe(40000);
    expect(saltCap(2050)).toBe(40000);
  });

  it("returns 10000 for pre-2026", () => {
    expect(saltCap(2025)).toBe(10000);
    expect(saltCap(2020)).toBe(10000);
  });
});

describe("aggregateDeductions", () => {
  it("sums all buckets and caps SALT at $40k for 2026", () => {
    const c1: DeductionContribution = { aboveLine: 10000, itemized: 5000, saltPool: 25000 };
    const c2: DeductionContribution = { aboveLine: 5000, itemized: 3000, saltPool: 20000 };
    const result = aggregateDeductions(2026, c1, c2);
    expect(result.aboveLine).toBe(15000);
    // SALT: 45000 capped at 40000 + itemized 8000 = 48000
    expect(result.itemized).toBe(48000);
  });

  it("caps SALT at $10k for pre-2026", () => {
    const c: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 25000 };
    const result = aggregateDeductions(2025, c);
    expect(result.itemized).toBe(10000);
  });

  it("does not inflate the cap", () => {
    const c: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 50000 };
    // 2050 still caps at 40k — no inflation
    expect(aggregateDeductions(2050, c).itemized).toBe(40000);
  });

  it("passes through SALT under the cap unchanged", () => {
    const c: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 15000 };
    expect(aggregateDeductions(2026, c).itemized).toBe(15000);
  });

  it("aggregates mixed sources before applying single cap", () => {
    // Manual property_tax deduction + expense-tagged + account property tax
    const manual: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 10000 };
    const expense: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 15000 };
    const account: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 20000 };
    const result = aggregateDeductions(2026, manual, expense, account);
    // Total SALT = 45000, capped at 40000
    expect(result.itemized).toBe(40000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/tax/__tests__/derive-deductions.test.ts`

Expected: Compilation errors — new functions and types don't exist yet.

- [ ] **Step 4: Implement the changes in derive-deductions.ts**

Replace the entire file content:

```typescript
/**
 * Pure helpers that derive deduction inputs for the bracket tax engine.
 *
 * Five sources aggregate into a unified DeductionContribution:
 *   1. Savings rules → 401k/IRA above-line (existing)
 *   2. Expenses tagged with a deductionType
 *   3. Manual client_deductions rows
 *   4. Mortgage interest from liabilities with isInterestDeductible
 *   5. Real estate account property taxes
 *
 * All SALT contributions pool before a single statutory cap ($40k OBBBA 2026+,
 * $10k TCJA pre-2026). The cap is a flat dollar amount — no inflation.
 */

// ── Contribution interface ──────────────────────────────────────────────────

export interface DeductionContribution {
  aboveLine: number;
  itemized: number;
  saltPool: number;
}

const EMPTY: DeductionContribution = { aboveLine: 0, itemized: 0, saltPool: 0 };

// ── SALT cap ────────────────────────────────────────────────────────────────

export function saltCap(year: number): number {
  return year >= 2026 ? 40_000 : 10_000;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

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

  const cappedSalt = Math.min(salt, saltCap(year));
  return { aboveLine, itemized: itemized + cappedSalt };
}

// ── Source 1: Savings rules → above-line ────────────────────────────────────

const DEDUCTIBLE_SUBTYPES = new Set(["traditional_ira", "401k"]);

export interface SavingsRuleForDeduction {
  accountId: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
}

export interface AccountForDeduction {
  id: string;
  subType: string;
  ownerEntityId?: string | null;
}

export function deriveAboveLineFromSavings(
  year: number,
  savingsRules: SavingsRuleForDeduction[],
  accounts: AccountForDeduction[],
  isGrantorEntity: (entityId: string) => boolean
): DeductionContribution {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  let total = 0;
  for (const rule of savingsRules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    const acct = accountById.get(rule.accountId);
    if (!acct) continue;
    if (!DEDUCTIBLE_SUBTYPES.has(acct.subType)) continue;
    if (acct.ownerEntityId != null && !isGrantorEntity(acct.ownerEntityId)) continue;
    total += rule.annualAmount;
  }
  return { aboveLine: total, itemized: 0, saltPool: 0 };
}

// ── Source 2: Expenses tagged with deductionType ────────────────────────────

export interface ExpenseForDeduction {
  deductionType?: "charitable" | "above_line" | "below_line" | "property_tax" | null;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  inflationStartYear?: number;
}

function inflateExpense(exp: ExpenseForDeduction, year: number): number {
  const baseYear = exp.inflationStartYear ?? exp.startYear;
  const elapsed = year - baseYear;
  return exp.annualAmount * Math.pow(1 + exp.growthRate, Math.max(0, elapsed));
}

export function deriveAboveLineFromExpenses(
  year: number,
  expenses: ExpenseForDeduction[]
): DeductionContribution {
  let total = 0;
  for (const exp of expenses) {
    if (exp.deductionType !== "above_line") continue;
    if (year < exp.startYear || year > exp.endYear) continue;
    total += inflateExpense(exp, year);
  }
  return { aboveLine: total, itemized: 0, saltPool: 0 };
}

export function deriveItemizedFromExpenses(
  year: number,
  expenses: ExpenseForDeduction[]
): DeductionContribution {
  let itemized = 0;
  let saltPool = 0;
  for (const exp of expenses) {
    if (!exp.deductionType || exp.deductionType === "above_line") continue;
    if (year < exp.startYear || year > exp.endYear) continue;
    const amount = inflateExpense(exp, year);
    if (exp.deductionType === "property_tax") {
      saltPool += amount;
    } else {
      itemized += amount;
    }
  }
  return { aboveLine: 0, itemized, saltPool };
}

// ── Source 3: Manual client_deductions rows ─────────────────────────────────

export interface ClientDeductionRow {
  type: "charitable" | "above_line" | "below_line" | "property_tax";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
}

export function sumItemizedFromEntries(
  year: number,
  rows: ClientDeductionRow[]
): DeductionContribution {
  let aboveLine = 0;
  let itemized = 0;
  let saltPool = 0;

  for (const row of rows) {
    if (year < row.startYear || year > row.endYear) continue;
    const yearsSinceStart = year - row.startYear;
    const inflated = row.annualAmount * Math.pow(1 + row.growthRate, yearsSinceStart);
    switch (row.type) {
      case "above_line":
        aboveLine += inflated;
        break;
      case "property_tax":
        saltPool += inflated;
        break;
      default: // charitable, below_line
        itemized += inflated;
        break;
    }
  }

  return { aboveLine, itemized, saltPool };
}

// ── Source 4: Mortgage interest from liabilities ────────────────────────────

export interface LiabilityForDeduction {
  id: string;
  isInterestDeductible: boolean;
  startYear: number;
  endYear: number;
}

export function deriveMortgageInterestFromLiabilities(
  year: number,
  liabilities: LiabilityForDeduction[],
  interestByLiability: Record<string, number>
): DeductionContribution {
  let total = 0;
  for (const liab of liabilities) {
    if (!liab.isInterestDeductible) continue;
    if (year < liab.startYear || year > liab.endYear) continue;
    total += interestByLiability[liab.id] ?? 0;
  }
  return { aboveLine: 0, itemized: total, saltPool: 0 };
}

// ── Source 5: Property taxes from real estate accounts ──────────────────────

export interface AccountForPropertyTax {
  id: string;
  name: string;
  category: string;
  annualPropertyTax: number;
  propertyTaxGrowthRate: number;
}

export function derivePropertyTaxFromAccounts(
  year: number,
  accounts: AccountForPropertyTax[],
  planStartYear: number
): DeductionContribution {
  let total = 0;
  for (const acct of accounts) {
    if (acct.category !== "real_estate") continue;
    if (acct.annualPropertyTax <= 0) continue;
    const elapsed = year - planStartYear;
    total += acct.annualPropertyTax * Math.pow(1 + acct.propertyTaxGrowthRate, Math.max(0, elapsed));
  }
  return { aboveLine: 0, itemized: 0, saltPool: total };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/tax/__tests__/derive-deductions.test.ts`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tax/derive-deductions.ts src/lib/tax/__tests__/derive-deductions.test.ts
git commit -m "feat(deductions): add DeductionContribution, 4 new helpers, aggregation with SALT cap"
```

---

## Task 7: Wire deductions into projection.ts

**Files:**
- Modify: `src/engine/projection.ts`

- [ ] **Step 1: Update imports**

Replace the existing import from `derive-deductions`:

```typescript
// OLD:
import {
  deriveAboveLineFromSavings,
  sumItemizedFromEntries,
} from "../lib/tax/derive-deductions";

// NEW:
import {
  deriveAboveLineFromSavings,
  deriveAboveLineFromExpenses,
  deriveItemizedFromExpenses,
  deriveMortgageInterestFromLiabilities,
  derivePropertyTaxFromAccounts,
  sumItemizedFromEntries,
  aggregateDeductions,
} from "../lib/tax/derive-deductions";
```

- [ ] **Step 2: Inject synthetic property-tax expenses**

At the top of the year loop, BEFORE `computeExpenses()` (around line 189), add:

```typescript
    // Inject synthetic property-tax expenses for real estate accounts.
    // These are not persisted — they exist only at projection time.
    const syntheticExpenses: typeof data.expenses = [];
    for (const acct of data.accounts) {
      if (acct.category !== "real_estate") continue;
      const propTax = acct.annualPropertyTax ?? 0;
      if (propTax <= 0) continue;
      const elapsed = year - planSettings.planStartYear;
      const inflated = propTax * Math.pow(1 + (acct.propertyTaxGrowthRate ?? 0.03), Math.max(0, elapsed));
      syntheticExpenses.push({
        id: `synth-proptax-${acct.id}`,
        type: "other",
        name: `Property Tax – ${acct.name}`,
        annualAmount: inflated,
        startYear: planSettings.planStartYear,
        endYear: planSettings.planEndYear,
        growthRate: 0, // already inflated
      });
    }
    const allExpenses = [...data.expenses, ...syntheticExpenses];
```

Then change the `computeExpenses` call to use `allExpenses`:

```typescript
    const expenseBreakdown = computeExpenses(
      allExpenses,
      year,
      (exp) => exp.ownerEntityId == null
    );
```

- [ ] **Step 3: Add realEstate to expense breakdown**

After the expense breakdown is computed, sum the synthetic expenses into a `realEstate` total. Find where the `expenses` object is built in the ProjectionYear output (search for `expenses: {`), and add:

```typescript
      realEstate: syntheticExpenses.reduce((sum, s) => sum + s.annualAmount, 0),
```

Also update the total to include realEstate if it's not already covered by `computeExpenses`.

Note: The synthetic expenses already flow through `computeExpenses` via `allExpenses`, so they're included in `expenseBreakdown.total` and `expenseBreakdown.bySource`. The `realEstate` field is an additional reporting breakdown — you just need to sum the synthetic amounts.

- [ ] **Step 4: Replace the deduction wiring with collect-then-cap**

Replace the existing `aboveLineDeductions` and `itemizedDeductions` computation (around lines 408-428):

```typescript
    // OLD:
    const aboveLineDeductions = useBracket
      ? deriveAboveLineFromSavings(...)
      : 0;
    const itemizedDeductions = useBracket
      ? sumItemizedFromEntries(year, data.deductions ?? [])
      : 0;

    // NEW:
    let aboveLineDeductions = 0;
    let itemizedDeductions = 0;
    if (useBracket) {
      const contributions = [
        deriveAboveLineFromSavings(
          year,
          data.savingsRules.map((r) => ({
            accountId: r.accountId,
            annualAmount: r.annualAmount,
            startYear: r.startYear,
            endYear: r.endYear,
          })),
          data.accounts.map((a) => ({
            id: a.id,
            subType: a.subType ?? "",
            ownerEntityId: a.ownerEntityId,
          })),
          isGrantorEntity
        ),
        deriveAboveLineFromExpenses(year, allExpenses.map((e) => ({
          deductionType: e.deductionType ?? null,
          annualAmount: e.annualAmount,
          startYear: e.startYear,
          endYear: e.endYear,
          growthRate: e.growthRate,
          inflationStartYear: e.inflationStartYear,
        }))),
        deriveItemizedFromExpenses(year, allExpenses.map((e) => ({
          deductionType: e.deductionType ?? null,
          annualAmount: e.annualAmount,
          startYear: e.startYear,
          endYear: e.endYear,
          growthRate: e.growthRate,
          inflationStartYear: e.inflationStartYear,
        }))),
        deriveMortgageInterestFromLiabilities(
          year,
          currentLiabilities.map((l) => ({
            id: l.id,
            isInterestDeductible: l.isInterestDeductible ?? false,
            startYear: l.startYear,
            endYear: l.endYear,
          })),
          liabResult.interestByLiability
        ),
        derivePropertyTaxFromAccounts(
          year,
          data.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            annualPropertyTax: a.annualPropertyTax ?? 0,
            propertyTaxGrowthRate: a.propertyTaxGrowthRate ?? 0.03,
          })),
          planSettings.planStartYear
        ),
        sumItemizedFromEntries(year, data.deductions ?? []),
      ];
      const agg = aggregateDeductions(year, ...contributions);
      aboveLineDeductions = agg.aboveLine;
      itemizedDeductions = agg.itemized;
    }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Clean (or expected UI errors from old enum values).

- [ ] **Step 6: Run existing tests**

Run: `npx vitest run src/engine/__tests__/projection.test.ts`

Expected: Most pass. The SALT cap test may need updating since the cap changed from $10k to $40k for 2026. Update:

In the test "applies SALT cap to itemized deductions", the SALT is $20k and the year is 2026 — under the new $40k cap, so it's no longer capped. Update the assertion:

```typescript
// OLD: expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThanOrEqual(35000);
// SALT $20k uncapped (under $40k) + charitable $25k = $45k
expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThanOrEqual(45000);
```

Also update the deduction type values in the test fixture from `"salt"` to `"property_tax"` and `"charitable_cash"` to `"charitable"`:

```typescript
deductions: [
  { type: "property_tax" as const, annualAmount: 20000, growthRate: 0, startYear: 2026, endYear: 2076 },
  { type: "charitable" as const, annualAmount: 25000, growthRate: 0, startYear: 2026, endYear: 2076 },
],
```

- [ ] **Step 7: Commit**

```bash
git add src/engine/projection.ts src/engine/__tests__/projection.test.ts
git commit -m "feat(deductions): wire collect-then-cap deductions into projection engine"
```

---

## Task 8: Add engine integration tests

**Files:**
- Modify: `src/engine/__tests__/fixtures.ts`
- Modify: `src/engine/__tests__/projection.test.ts`

- [ ] **Step 1: Add real estate account + deductible mortgage to fixtures**

In `fixtures.ts`, add to `sampleAccounts`:

```typescript
  {
    id: "acct-home",
    name: "Primary Home",
    category: "real_estate",
    subType: "primary_residence",
    owner: "joint",
    value: 750000,
    basis: 500000,
    growthRate: 0.04,
    rmdEnabled: false,
    annualPropertyTax: 12000,
    propertyTaxGrowthRate: 0.03,
  },
```

Update `sampleLiabilities` to include `isInterestDeductible`:

```typescript
export const sampleLiabilities: Liability[] = [
  {
    id: "liab-mortgage",
    name: "Mortgage",
    balance: 300000,
    interestRate: 0.065,
    monthlyPayment: 2500,
    startYear: 2026,
    endYear: 2046,
    isInterestDeductible: true,
  },
];
```

- [ ] **Step 2: Write 3 new integration tests**

Add to `projection.test.ts` inside `describe("projection — bracket/flat tax routing")`:

```typescript
  it("derives mortgage interest deduction from isInterestDeductible liability", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    // Mortgage balance 300k at 6.5% = ~$19,500 interest. With isInterestDeductible=true,
    // this should appear in below-line deductions.
    expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThan(0);
  });

  it("derives property tax from real estate accounts into SALT pool", () => {
    const fixture = buildClientData({
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    // Property tax of $12k flows into SALT pool (under $40k cap)
    expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThan(0);
    // Verify realEstate expense category is populated
    expect(firstYear.expenses.realEstate).toBeGreaterThan(0);
  });

  it("routes charitable-tagged expense into itemized deductions", () => {
    const charitableExpense = {
      id: "exp-charity",
      type: "other" as const,
      name: "Annual Giving",
      annualAmount: 25000,
      startYear: 2026,
      endYear: 2055,
      growthRate: 0,
      deductionType: "charitable" as const,
    };
    const fixture = buildClientData({
      expenses: [...sampleExpenses, charitableExpense],
      planSettings: { ...basePlanSettings, taxEngineMode: "bracket", planStartYear: 2026, planEndYear: 2026 },
    });
    const years = runProjection({ ...fixture, taxYearRows: FIXTURE_TAX_PARAMS });
    const firstYear = years[0];
    expect(firstYear.taxResult).toBeDefined();
    // $25k charitable + mortgage interest + property tax SALT → below-line > 25k
    expect(firstYear.taxResult!.flow.belowLineDeductions).toBeGreaterThanOrEqual(25000);
  });
```

Add `sampleExpenses` to the import from `./fixtures` if not already imported.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/engine/__tests__/projection.test.ts`

Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/engine/__tests__/fixtures.ts src/engine/__tests__/projection.test.ts
git commit -m "test(deductions): add integration tests for mortgage interest, property tax, charitable expense"
```

---

## Task 9: Update API routes to handle new fields

**Files:**
- Modify: `src/app/api/clients/[id]/expenses/route.ts`
- Modify: `src/app/api/clients/[id]/expenses/[expenseId]/route.ts`
- Modify: `src/app/api/clients/[id]/liabilities/route.ts` (or equivalent)
- Modify: `src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts` (or equivalent)
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Add deductionType to expense POST**

In `src/app/api/clients/[id]/expenses/route.ts`, in the POST handler's destructuring (around line 67-77), add:

```typescript
    const {
      type, name, annualAmount, startYear, endYear, growthRate,
      ownerEntityId, cashAccountId, inflationStartYear,
      deductionType,  // ← NEW
    } = body;
```

And in the `db.insert(expenses).values({...})` call, add:

```typescript
        deductionType: deductionType ?? null,
```

- [ ] **Step 2: Add deductionType to expense PUT**

In `src/app/api/clients/[id]/expenses/[expenseId]/route.ts`, add `deductionType` to the update set:

```typescript
        ...(body.deductionType !== undefined && { deductionType: body.deductionType }),
```

- [ ] **Step 3: Add isInterestDeductible to liability POST and PUT**

In the liability POST route, add `isInterestDeductible: body.isInterestDeductible ?? false` to the insert values.

In the liability PUT route, add:

```typescript
        ...(body.isInterestDeductible !== undefined && { isInterestDeductible: body.isInterestDeductible }),
```

- [ ] **Step 4: Add property tax fields to account POST and PUT**

In the accounts POST route, add to the insert values:

```typescript
        annualPropertyTax: body.annualPropertyTax ?? "0",
        propertyTaxGrowthRate: body.propertyTaxGrowthRate ?? "0.03",
```

In the accounts PUT route, add:

```typescript
        ...(body.annualPropertyTax !== undefined && { annualPropertyTax: body.annualPropertyTax }),
        ...(body.propertyTaxGrowthRate !== undefined && { propertyTaxGrowthRate: body.propertyTaxGrowthRate }),
```

- [ ] **Step 5: Update projection-data route to emit new fields**

In `src/app/api/clients/[id]/projection-data/route.ts`:

In the `expenses` map (around line 266-277), add:

```typescript
        deductionType: e.deductionType ?? undefined,
```

In the `liabilities` map (around line 278-288), add:

```typescript
        isInterestDeductible: l.isInterestDeductible,
```

In the `accounts` map (around line 187-249), for the return object add:

```typescript
          annualPropertyTax: parseFloat(a.annualPropertyTax),
          propertyTaxGrowthRate: parseFloat(a.propertyTaxGrowthRate),
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Clean (or expected UI errors from old enum values — fixed in next tasks).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/clients/[id]/expenses/route.ts \
  src/app/api/clients/[id]/expenses/*/route.ts \
  src/app/api/clients/[id]/liabilities/route.ts \
  src/app/api/clients/[id]/liabilities/*/route.ts \
  src/app/api/clients/[id]/accounts/route.ts \
  src/app/api/clients/[id]/projection-data/route.ts
git commit -m "feat(deductions): add new fields to expense/liability/account/projection API routes"
```

---

## Task 10: Update deduction form + itemized list (v2 enum)

**Files:**
- Modify: `src/components/forms/add-deduction-form.tsx`
- Modify: `src/components/deductions-itemized-list.tsx`

- [ ] **Step 1: Update add-deduction-form.tsx**

Replace the `DeductionRow` type and `TYPE_OPTIONS`:

```typescript
interface DeductionRow {
  id: string;
  type: "charitable" | "above_line" | "below_line" | "property_tax";
  name: string | null;
  owner: "client" | "spouse" | "joint";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
}

const TYPE_OPTIONS: Array<{ value: DeductionRow["type"]; label: string }> = [
  { value: "charitable", label: "Charitable Gift" },
  { value: "above_line", label: "Above Line Deduction" },
  { value: "below_line", label: "Below Line Deduction" },
  { value: "property_tax", label: "Property Tax" },
];
```

Update the SALT warning (around line 114-119) to reference the new type and cap:

```typescript
        {type === "property_tax" && (
          <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
            Property taxes contribute to SALT, which is capped at $40,000 (OBBBA).
            Enter your total; the engine will apply the cap across all sources.
          </p>
        )}
```

Update the default type in useState (line 39):

```typescript
  const [type, setType] = useState<DeductionRow["type"]>(existing?.type ?? "charitable");
```

- [ ] **Step 2: Update deductions-itemized-list.tsx labels**

Find the type label mapping and replace with v2 labels. Update any reference to `"charitable_cash"`, `"charitable_non_cash"`, `"salt"`, `"mortgage_interest"`, or `"other_itemized"` with the v2 equivalents.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/forms/add-deduction-form.tsx src/components/deductions-itemized-list.tsx
git commit -m "feat(deductions): update deduction form and itemized list to v2 enum"
```

---

## Task 11: Add deductionType select to ExpenseDialog

**Files:**
- Modify: `src/components/income-expenses-view.tsx`

- [ ] **Step 1: Add deductionType to Expense interface**

In the `Expense` interface (around line 59-72), add:

```typescript
  deductionType?: string | null;
```

- [ ] **Step 2: Add deductionType state to ExpenseDialog**

Inside the `ExpenseDialog` function (around line 745-754), add state:

```typescript
  const [deductionType, setDeductionType] = useState<string>(editing?.deductionType ?? "");
```

- [ ] **Step 3: Add deductionType to the submit body**

In `handleSubmit` (around line 778-790), add to the body object:

```typescript
      deductionType: deductionType || null,
```

- [ ] **Step 4: Add the select to the form JSX**

After the last field in the form (before the today's-dollars toggle or the entity picker), add:

```tsx
          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="exp-deductionType">Tax Treatment</label>
            <select
              id="exp-deductionType"
              value={deductionType}
              onChange={(e) => setDeductionType(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">None (not a deduction)</option>
              <option value="charitable">Charitable Gift</option>
              <option value="above_line">Above Line Deduction</option>
              <option value="below_line">Below Line Deduction</option>
              <option value="property_tax">Property Tax</option>
            </select>
          </div>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/income-expenses-view.tsx
git commit -m "feat(deductions): add Tax Treatment select to ExpenseDialog"
```

---

## Task 12: Add isInterestDeductible checkbox to liability form

**Files:**
- Modify: `src/components/forms/add-liability-form.tsx`

- [ ] **Step 1: Add isInterestDeductible to LiabilityFormInitial**

In the `LiabilityFormInitial` interface (around line 9-21), add:

```typescript
  isInterestDeductible?: boolean;
```

- [ ] **Step 2: Add state**

After the existing state declarations (around line 47-48), add:

```typescript
  const [isInterestDeductible, setIsInterestDeductible] = useState(initial?.isInterestDeductible ?? false);
```

- [ ] **Step 3: Add to submit body**

In `handleSubmit`, add to the `body` object (around line 77-88):

```typescript
      isInterestDeductible,
```

- [ ] **Step 4: Add checkbox to form JSX**

After the entity picker section and before the year pickers (around line 279), add:

```tsx
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={isInterestDeductible}
              onChange={(e) => setIsInterestDeductible(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
            />
            Interest is tax-deductible
          </label>
          <p className="mt-1 ml-6 text-xs text-gray-500">
            When checked, the annual interest portion flows into your itemized deductions (e.g., mortgage interest).
          </p>
        </div>
```

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/add-liability-form.tsx
git commit -m "feat(deductions): add isInterestDeductible checkbox to liability form"
```

---

## Task 13: Add real estate property tax fields to account form

**Files:**
- Modify: `src/components/forms/add-account-form.tsx`

- [ ] **Step 1: Read the account form to identify the right insertion point**

Read `src/components/forms/add-account-form.tsx` and find where category-specific fields are rendered (e.g., `rmdEnabled` for retirement). The property tax fields should render conditionally when `category === "real_estate"`.

- [ ] **Step 2: Add state for property tax fields**

```typescript
  const [annualPropertyTax, setAnnualPropertyTax] = useState(initial?.annualPropertyTax ?? "0");
  const [propertyTaxGrowthRate, setPropertyTaxGrowthRate] = useState(
    initial?.propertyTaxGrowthRate != null ? (Number(initial.propertyTaxGrowthRate) * 100).toString() : "3"
  );
```

- [ ] **Step 3: Add to submit body**

In the submit handler, add to the body object (conditionally for real estate):

```typescript
      annualPropertyTax: category === "real_estate" ? annualPropertyTax : undefined,
      propertyTaxGrowthRate: category === "real_estate" ? String(Number(propertyTaxGrowthRate) / 100) : undefined,
```

- [ ] **Step 4: Add conditional fields to form JSX**

After the existing category-specific fields, add:

```tsx
          {category === "real_estate" && (
            <>
              <h4 className="col-span-2 mt-2 text-sm font-medium text-gray-400">Real Estate Details</h4>
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="annualPropertyTax">
                  Annual Property Tax ($)
                </label>
                <input
                  id="annualPropertyTax"
                  type="number"
                  step="100"
                  min={0}
                  value={annualPropertyTax}
                  onChange={(e) => setAnnualPropertyTax(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="propertyTaxGrowthRate">
                  Property Tax Growth Rate (%)
                </label>
                <input
                  id="propertyTaxGrowthRate"
                  type="number"
                  step="0.1"
                  min={0}
                  value={propertyTaxGrowthRate}
                  onChange={(e) => setPropertyTaxGrowthRate(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/forms/add-account-form.tsx
git commit -m "feat(deductions): add property tax fields to account form for real estate"
```

---

## Task 14: Expand deductions-derived-summary.tsx

**Files:**
- Modify: `src/components/deductions-derived-summary.tsx`
- Modify: `src/app/(app)/clients/[id]/client-data/deductions/page.tsx`
- Modify: `src/app/(app)/clients/[id]/client-data/deductions/deductions-client.tsx`

- [ ] **Step 1: Expand DeductionsDerivedSummary component**

Replace the entire component with the expanded version that shows 4 source groups:

```typescript
"use client";

interface DerivedRow {
  id: string;
  accountName: string;
  subType: string;
  annualAmount: number;
  owner: "client" | "spouse" | "joint";
  startYear: number;
  endYear: number;
}

interface ExpenseDeductionRow {
  id: string;
  name: string;
  deductionType: string;
  annualAmount: number;
}

interface MortgageInterestRow {
  id: string;
  name: string;
  estimatedInterest: number;
}

interface PropertyTaxRow {
  id: string;
  name: string;
  annualPropertyTax: number;
  currentYearInflated: number;
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const SUBTYPE_LABELS: Record<string, string> = {
  traditional_ira: "Traditional IRA",
  "401k": "401(k) Traditional",
};

const OWNER_LABELS: Record<string, string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

const DEDUCTION_TYPE_LABELS: Record<string, string> = {
  charitable: "Charitable",
  above_line: "Above Line",
  below_line: "Below Line",
  property_tax: "Property Tax",
};

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-medium text-gray-300">{title}</h3>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/60 px-4 py-4 text-center text-sm text-gray-400">
      {message}
    </div>
  );
}

export function DeductionsDerivedSummary({
  savingsRows,
  expenseRows,
  mortgageRows,
  propertyTaxRows,
  currentYear,
  saltCap,
}: {
  savingsRows: DerivedRow[];
  expenseRows: ExpenseDeductionRow[];
  mortgageRows: MortgageInterestRow[];
  propertyTaxRows: PropertyTaxRow[];
  currentYear: number;
  saltCap: number;
}) {
  const savingsTotal = savingsRows.reduce((sum, r) => sum + r.annualAmount, 0);
  const expenseAboveLine = expenseRows.filter((e) => e.deductionType === "above_line").reduce((s, e) => s + e.annualAmount, 0);
  const expenseItemized = expenseRows.filter((e) => e.deductionType !== "above_line").reduce((s, e) => s + e.annualAmount, 0);
  const mortgageTotal = mortgageRows.reduce((s, r) => s + r.estimatedInterest, 0);
  const propertyTaxTotal = propertyTaxRows.reduce((s, r) => s + r.currentYearInflated, 0);
  const totalAboveLine = savingsTotal + expenseAboveLine;
  const rawSalt = propertyTaxTotal + expenseRows.filter((e) => e.deductionType === "property_tax").reduce((s, e) => s + e.annualAmount, 0);
  const cappedSalt = Math.min(rawSalt, saltCap);
  const totalItemized = expenseItemized + mortgageTotal + cappedSalt;

  return (
    <section className="space-y-5 rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div>
        <h2 className="text-base font-semibold text-gray-200">Auto-derived deductions</h2>
        <p className="mt-1 text-xs text-gray-500">
          These deductions are computed from data you enter elsewhere — savings rules, expenses, liabilities, and real estate accounts.
        </p>
      </div>

      {/* Savings → above-line */}
      <div>
        <SectionHeader title="From your savings (above-line)" subtitle="Edit on the Income, Expenses & Savings tab." />
        {savingsRows.length === 0 ? (
          <EmptyState message="No deductible savings rules yet. Add a Traditional IRA or 401(k) contribution on the Savings tab." />
        ) : (
          <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
            {savingsRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="text-gray-200">{r.accountName}</span>
                  <span className="text-xs text-gray-500">{SUBTYPE_LABELS[r.subType] ?? r.subType} · {OWNER_LABELS[r.owner]} · {r.startYear}-{r.endYear}</span>
                </div>
                <span className="tabular-nums text-gray-300">{fmt.format(r.annualAmount)}/yr</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Expenses → various */}
      <div>
        <SectionHeader title="From your expenses" subtitle="Edit on the Income, Expenses & Savings tab." />
        {expenseRows.length === 0 ? (
          <EmptyState message="No expenses tagged as deductions. Set the Tax Treatment on an expense to include it here." />
        ) : (
          <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
            {expenseRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="text-gray-200">{r.name}</span>
                  <span className="text-xs text-gray-500">{DEDUCTION_TYPE_LABELS[r.deductionType] ?? r.deductionType}</span>
                </div>
                <span className="tabular-nums text-gray-300">{fmt.format(r.annualAmount)}/yr</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Mortgages → below-line */}
      <div>
        <SectionHeader title="From your mortgages (below-line)" subtitle="Toggle on the Liabilities tab." />
        {mortgageRows.length === 0 ? (
          <EmptyState message="No liabilities with deductible interest. Check &quot;Interest is tax-deductible&quot; on a liability." />
        ) : (
          <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
            {mortgageRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-200">{r.name}</span>
                <span className="tabular-nums text-gray-300">~{fmt.format(r.estimatedInterest)} interest ({currentYear})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Real estate → SALT */}
      <div>
        <SectionHeader title="From your real estate (SALT)" subtitle="Edit on the Balance Sheet." />
        {propertyTaxRows.length === 0 ? (
          <EmptyState message="No real estate accounts with property taxes. Add Annual Property Tax on a real estate account." />
        ) : (
          <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
            {propertyTaxRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-200">{r.name}</span>
                <span className="tabular-nums text-gray-300">{fmt.format(r.currentYearInflated)}/yr</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Totals */}
      <div className="space-y-1 border-t border-gray-800 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Total above-line for {currentYear}:</span>
          <span className="tabular-nums font-semibold text-gray-100">{fmt.format(totalAboveLine)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Total itemized for {currentYear}:</span>
          <span className="tabular-nums font-semibold text-gray-100">
            {fmt.format(totalItemized)}
            {rawSalt > 0 && (
              <span className="ml-1 text-xs font-normal text-gray-500">
                (SALT: {fmt.format(rawSalt)}{rawSalt > saltCap ? ` → capped at ${fmt.format(saltCap)}` : ""})
              </span>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Update deductions page.tsx to pass new props**

Update the server component to load expenses (filtered to those with `deductionType` set), liabilities with `isInterestDeductible`, and real estate accounts with `annualPropertyTax > 0`. Compute current-year interest for mortgage rows via `amortizeLiability`. Pass all new props to the client component.

- [ ] **Step 3: Update deductions-client.tsx to thread props**

Update the client wrapper to accept and pass the new props to `DeductionsDerivedSummary`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/deductions-derived-summary.tsx \
  "src/app/(app)/clients/[id]/client-data/deductions/page.tsx" \
  "src/app/(app)/clients/[id]/client-data/deductions/deductions-client.tsx"
git commit -m "feat(deductions): expand derived summary with 4 auto-derived source groups"
```

---

## Task 15: Add Real Estate Expenses drill-down to cashflow report

**Files:**
- Modify: `src/components/cashflow-report.tsx`

- [ ] **Step 1: Add realEstate column to expense drill-down**

In the expense categories section (around line 802-835), add a `realEstate` column between `insurance` and `taxes`:

```typescript
        numCol("expenses_real_estate", "Real Estate", (r) => r.expenses.realEstate),
```

- [ ] **Step 2: Add real_estate drill-down level**

Follow the existing pattern for `living` and `other_expense` drill-down. When the user clicks into "Real Estate", show sub-columns for "Property Taxes" and "Other RE Expenses" (placeholder at $0). For property taxes, show per-property drill-down from `expenses.bySource` keyed by the synthetic expense IDs (`synth-proptax-{accountId}`).

This follows the same pattern as the existing income/expense drill-downs — add a new `DrillBtn` for Real Estate and a corresponding column set when `level === "real_estate"`.

- [ ] **Step 3: Verify the app runs and the drill-down works**

Start the dev server: `npm run dev`

Navigate to a client with a real estate account that has property taxes set. Check the cashflow report for the "Real Estate" expense column and drill-down.

- [ ] **Step 4: Commit**

```bash
git add src/components/cashflow-report.tsx
git commit -m "feat(deductions): add Real Estate Expenses drill-down to cashflow report"
```

---

## Task 16: Run full test suite + manual smoke

**Files:** None

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass (existing 250+ plus ~28 new tests).

- [ ] **Step 2: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Manual smoke test**

1. Migration runs cleanly; new columns exist; `client_deductions` rows migrated to v2 enum
2. Add expense with Tax Treatment: "Charitable Gift" → appears in auto-derived summary, tax recalculates
3. Toggle "Interest is tax-deductible" on a mortgage → interest appears in derived summary, tax recalculates
4. Add `Annual Property Tax: $12,000` on a real estate account → synthetic expense appears in cashflow "Real Estate" row with drill-down to per-property
5. SALT cap shown correctly ($40k for 2026+)
6. Multiple SALT sources (manual property_tax deduction + expense-tagged + account) → aggregate before single cap
7. Existing manual `client_deductions` rows display with new enum labels
8. Deduction form shows v2 type options
9. Flat-mode regression: deductions computed but taxes still use flat rate
10. Client with no tagged expenses, no deductible liabilities, no real estate → all empty states render correctly
