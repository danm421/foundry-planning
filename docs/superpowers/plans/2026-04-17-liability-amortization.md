# Liability Amortization & Extra Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform liabilities from flat payment entries into a full loan calculator with amortization schedules, extra payment modeling, and live visualization — all flowing through to the projection engine.

**Architecture:** New `loan-math.ts` pure utility handles the three-way solve (payment/term/rate). Engine's `amortizeLiability()` gains extra-payment awareness. New `extra_payments` DB table with CRUD API. Liability dialog becomes tabbed: Details (form with calculator buttons) + Amortization (schedule table, extra payment editor, Chart.js line graph). Schema migrates from `endYear` to `termMonths`.

**Tech Stack:** TypeScript, Next.js 16, Drizzle ORM, Postgres (Neon), React 19, Chart.js, vitest.

**Spec:** [docs/superpowers/specs/2026-04-17-liability-amortization-design.md](../specs/2026-04-17-liability-amortization-design.md)

---

## File Structure

```
src/lib/loan-math.ts                                               CREATE  (~80 lines)
src/lib/__tests__/loan-math.test.ts                                 CREATE  (~60 lines)

src/db/migrations/0019_liability_amortization.sql                   CREATE
src/db/migrations/meta/_journal.json                                MODIFY  (idx 19)
src/db/schema.ts                                                    MODIFY  (liabilities table + extra_payments table + enum)

src/engine/types.ts                                                 MODIFY  (Liability interface, ExtraPayment interface)
src/engine/liabilities.ts                                           MODIFY  (extra payments in amortization)
src/engine/__tests__/fixtures.ts                                    MODIFY  (update sampleLiabilities)
src/engine/__tests__/liabilities.test.ts                            MODIFY  (new extra payment tests)

src/app/api/clients/[id]/liabilities/route.ts                       MODIFY  (termMonths/termUnit)
src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts         MODIFY  (termMonths/termUnit)
src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/route.ts          CREATE
src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/[extraPaymentId]/route.ts  CREATE
src/app/api/clients/[id]/projection-data/route.ts                   MODIFY  (join extra_payments)

src/app/(app)/clients/[id]/client-data/deductions/page.tsx          MODIFY  (termMonths instead of endYear)

src/components/forms/add-liability-form.tsx                          MODIFY  (term fields, calculator buttons)
src/components/add-liability-dialog.tsx                              MODIFY  (tabbed layout)
src/components/liability-amortization-tab.tsx                        CREATE  (~250 lines)
src/components/balance-sheet-view.tsx                                MODIFY  (minor: dialog prop changes)
src/components/import/review-step-liabilities.tsx                    MODIFY  (term default)
```

---

## Task 1: Loan Math Utility

Pure functions for the three-way loan calculator. No dependencies on the rest of the codebase.

**Files:**
- Create: `src/lib/loan-math.ts`
- Create: `src/lib/__tests__/loan-math.test.ts`

- [ ] **Step 1: Write failing tests for payment calculation**

```typescript
// src/lib/__tests__/loan-math.test.ts
import { describe, it, expect } from "vitest";
import { calcPayment, calcTerm, calcRate } from "../loan-math";

describe("calcPayment", () => {
  it("computes monthly payment for a 30-year mortgage", () => {
    // $300,000 at 6.5% for 360 months
    const payment = calcPayment(300000, 0.065, 360);
    expect(payment).toBeCloseTo(1896.2, 0);
  });

  it("returns balance / term when rate is zero", () => {
    const payment = calcPayment(120000, 0, 240);
    expect(payment).toBeCloseTo(500, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/lib/__tests__/loan-math.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement calcPayment**

```typescript
// src/lib/loan-math.ts

/**
 * Monthly payment from balance, annual rate, and term in months.
 * Standard amortization formula: P × r(1+r)^n / ((1+r)^n − 1)
 */
export function calcPayment(
  balance: number,
  annualRate: number,
  termMonths: number
): number {
  if (termMonths <= 0) return 0;
  if (annualRate === 0) return balance / termMonths;
  const r = annualRate / 12;
  const factor = Math.pow(1 + r, termMonths);
  return balance * r * factor / (factor - 1);
}
```

- [ ] **Step 4: Run tests to verify calcPayment passes**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/lib/__tests__/loan-math.test.ts`
Expected: 2 PASS

- [ ] **Step 5: Write failing tests for term calculation**

Add to `src/lib/__tests__/loan-math.test.ts`:

```typescript
describe("calcTerm", () => {
  it("computes term for a 30-year mortgage", () => {
    const term = calcTerm(300000, 0.065, 1896.2);
    expect(term).toBeCloseTo(360, 0);
  });

  it("returns Infinity when payment does not cover interest", () => {
    // Interest = 300000 * 0.065/12 = 1625/mo, payment = 1000
    const term = calcTerm(300000, 0.065, 1000);
    expect(term).toBe(Infinity);
  });

  it("returns balance / payment when rate is zero", () => {
    const term = calcTerm(120000, 0, 500);
    expect(term).toBe(240);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/lib/__tests__/loan-math.test.ts`
Expected: 3 FAIL (calcTerm not found)

- [ ] **Step 7: Implement calcTerm**

Add to `src/lib/loan-math.ts`:

```typescript
/**
 * Term in months from balance, annual rate, and monthly payment.
 * n = −ln(1 − balance × r / payment) / ln(1 + r)
 * Returns Infinity if payment ≤ monthly interest (never pays off).
 */
export function calcTerm(
  balance: number,
  annualRate: number,
  monthlyPayment: number
): number {
  if (monthlyPayment <= 0) return Infinity;
  if (annualRate === 0) return Math.ceil(balance / monthlyPayment);
  const r = annualRate / 12;
  const monthlyInterest = balance * r;
  if (monthlyPayment <= monthlyInterest) return Infinity;
  return Math.ceil(-Math.log(1 - balance * r / monthlyPayment) / Math.log(1 + r));
}
```

- [ ] **Step 8: Run tests to verify calcTerm passes**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/lib/__tests__/loan-math.test.ts`
Expected: 5 PASS

- [ ] **Step 9: Write failing tests for rate calculation**

Add to `src/lib/__tests__/loan-math.test.ts`:

```typescript
describe("calcRate", () => {
  it("solves for rate on a 30-year mortgage", () => {
    const rate = calcRate(300000, 360, 1896.2);
    expect(rate).toBeCloseTo(0.065, 3);
  });

  it("returns 0 when payment equals balance / term (zero interest)", () => {
    const rate = calcRate(120000, 240, 500);
    expect(rate).toBeCloseTo(0, 3);
  });

  it("returns null when solver cannot converge", () => {
    // Payment less than any positive-rate amortization of this balance/term
    const rate = calcRate(1000000, 12, 1);
    expect(rate).toBeNull();
  });
});
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/lib/__tests__/loan-math.test.ts`
Expected: 3 FAIL (calcRate not found)

- [ ] **Step 11: Implement calcRate**

Add to `src/lib/loan-math.ts`:

```typescript
/**
 * Annual interest rate from balance, term in months, and monthly payment.
 * Uses Newton-Raphson iteration on the amortization formula.
 * Returns null if the solver does not converge within 100 iterations.
 */
export function calcRate(
  balance: number,
  termMonths: number,
  monthlyPayment: number
): number | null {
  if (balance <= 0 || termMonths <= 0 || monthlyPayment <= 0) return null;

  // Check if zero-interest matches
  if (Math.abs(monthlyPayment - balance / termMonths) < 0.01) return 0;

  let r = 0.005; // initial guess: 6% annual / 12
  const n = termMonths;

  for (let i = 0; i < 100; i++) {
    const rn = Math.pow(1 + r, n);
    const f = balance * r * rn / (rn - 1) - monthlyPayment;
    // derivative of amortization formula w.r.t. r
    const drndr = n * Math.pow(1 + r, n - 1);
    const num = rn + r * drndr;
    const den = rn - 1;
    const dfdr = balance * (num * den - r * rn * drndr) / (den * den);

    if (Math.abs(dfdr) < 1e-12) return null;
    const rNext = r - f / dfdr;
    if (rNext <= 0) r = r / 2; // guard against negative
    else r = rNext;

    if (Math.abs(f) < 0.01) return r * 12;
  }

  return null;
}
```

- [ ] **Step 12: Run tests to verify calcRate passes**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/lib/__tests__/loan-math.test.ts`
Expected: 8 PASS

- [ ] **Step 13: Add computeAmortizationSchedule utility**

This is used by both the engine and the UI to produce the full year-by-year table. Add to `src/lib/loan-math.ts`:

```typescript
export interface AmortizationScheduleRow {
  year: number;
  beginningBalance: number;
  payment: number;
  interest: number;
  principal: number;
  extraPayment: number;
  endingBalance: number;
}

export interface ScheduleExtraPayment {
  year: number;
  type: "per_payment" | "lump_sum";
  amount: number;
}

/**
 * Full amortization schedule from loan parameters + optional extra payments.
 * Returns one row per year from startYear until payoff or contractual end.
 */
export function computeAmortizationSchedule(
  balance: number,
  annualRate: number,
  monthlyPayment: number,
  startYear: number,
  termMonths: number,
  extraPayments: ScheduleExtraPayment[] = []
): AmortizationScheduleRow[] {
  const endYear = startYear + Math.ceil(termMonths / 12) - 1;
  const rows: AmortizationScheduleRow[] = [];
  let bal = balance;

  for (let year = startYear; year <= endYear; year++) {
    if (bal <= 0) break;

    const interest = bal * annualRate;
    const scheduled = Math.min(monthlyPayment * 12, bal + interest);

    const perPayment = extraPayments
      .filter((ep) => ep.year === year && ep.type === "per_payment")
      .reduce((sum, ep) => sum + ep.amount * 12, 0);
    const lumpSum = extraPayments
      .filter((ep) => ep.year === year && ep.type === "lump_sum")
      .reduce((sum, ep) => sum + ep.amount, 0);

    const totalExtra = perPayment + lumpSum;
    const interestPortion = Math.min(interest, scheduled);
    const principalFromPayment = scheduled - interestPortion;
    const totalPrincipal = Math.min(principalFromPayment + totalExtra, bal);
    const endBal = Math.max(0, bal - totalPrincipal);

    rows.push({
      year,
      beginningBalance: bal,
      payment: scheduled,
      interest: interestPortion,
      principal: principalFromPayment,
      extraPayment: Math.min(totalExtra, bal - principalFromPayment + interestPortion),
      endingBalance: endBal,
    });

    bal = endBal;
  }

  return rows;
}
```

- [ ] **Step 14: Write tests for computeAmortizationSchedule**

Add to `src/lib/__tests__/loan-math.test.ts`:

```typescript
import {
  calcPayment,
  calcTerm,
  calcRate,
  computeAmortizationSchedule,
} from "../loan-math";

describe("computeAmortizationSchedule", () => {
  it("produces correct number of rows for a simple loan", () => {
    const rows = computeAmortizationSchedule(120000, 0.06, 1000, 2026, 240);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(rows[0].year).toBe(2026);
    expect(rows[0].beginningBalance).toBe(120000);
  });

  it("ending balance reaches zero by final row", () => {
    const payment = calcPayment(120000, 0.06, 240);
    const rows = computeAmortizationSchedule(120000, 0.06, payment, 2026, 240);
    const last = rows[rows.length - 1];
    expect(last.endingBalance).toBeCloseTo(0, 0);
  });

  it("per-payment extra shortens payoff", () => {
    const payment = calcPayment(120000, 0.06, 240);
    const noExtra = computeAmortizationSchedule(120000, 0.06, payment, 2026, 240);
    const withExtra = computeAmortizationSchedule(120000, 0.06, payment, 2026, 240, [
      { year: 2026, type: "per_payment", amount: 200 },
      { year: 2027, type: "per_payment", amount: 200 },
      { year: 2028, type: "per_payment", amount: 200 },
    ]);
    // Extra payments in early years reduce ending balance
    expect(withExtra[2].endingBalance).toBeLessThan(noExtra[2].endingBalance);
  });

  it("lump sum reduces balance in the target year", () => {
    const payment = calcPayment(300000, 0.065, 360);
    const rows = computeAmortizationSchedule(300000, 0.065, payment, 2026, 360, [
      { year: 2028, type: "lump_sum", amount: 50000 },
    ]);
    // Year 2028 (index 2) should show extra payment and reduced ending balance
    expect(rows[2].extraPayment).toBeGreaterThan(0);
    const noExtra = computeAmortizationSchedule(300000, 0.065, payment, 2026, 360);
    expect(rows[2].endingBalance).toBeLessThan(noExtra[2].endingBalance);
  });

  it("handles zero interest rate", () => {
    const rows = computeAmortizationSchedule(24000, 0, 1000, 2026, 24);
    expect(rows[0].interest).toBe(0);
    expect(rows[0].principal).toBe(12000);
    expect(rows[0].endingBalance).toBe(12000);
  });
});
```

- [ ] **Step 15: Run all loan-math tests**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/lib/__tests__/loan-math.test.ts`
Expected: 13 PASS

- [ ] **Step 16: Commit**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add src/lib/loan-math.ts src/lib/__tests__/loan-math.test.ts
git commit -m "feat: add loan-math utility with three-way solver and amortization schedule"
```

---

## Task 2: Engine Types & Liabilities Update

Update engine types to use `termMonths` and `ExtraPayment`, then update amortization logic.

**Files:**
- Modify: `src/engine/types.ts:108-119`
- Modify: `src/engine/liabilities.ts` (entire file)
- Modify: `src/engine/__tests__/fixtures.ts:148-159`
- Modify: `src/engine/__tests__/liabilities.test.ts` (entire file)

- [ ] **Step 1: Update engine Liability type and add ExtraPayment**

In `src/engine/types.ts`, replace the `Liability` interface (lines 108-119):

```typescript
export interface ExtraPayment {
  id: string;
  liabilityId: string;
  year: number;
  type: "per_payment" | "lump_sum";
  amount: number;
}

export interface Liability {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  startYear: number;
  termMonths: number;
  linkedPropertyId?: string;
  ownerEntityId?: string;
  isInterestDeductible?: boolean;
  extraPayments: ExtraPayment[];
}
```

- [ ] **Step 2: Update test fixtures**

In `src/engine/__tests__/fixtures.ts`, replace `sampleLiabilities` (lines 148-159):

```typescript
export const sampleLiabilities: Liability[] = [
  {
    id: "liab-mortgage",
    name: "Mortgage",
    balance: 300000,
    interestRate: 0.065,
    monthlyPayment: 2500,
    startYear: 2026,
    termMonths: 240,
    isInterestDeductible: true,
    extraPayments: [],
  },
];
```

Also add the `ExtraPayment` import if `Liability` is already imported:

```typescript
import type { Liability, ExtraPayment } from "../types";
```

- [ ] **Step 3: Write failing tests for extra payment support**

Add new test cases to `src/engine/__tests__/liabilities.test.ts`:

```typescript
describe("amortizeLiability with extra payments", () => {
  it("per-payment extra increases annual payment and reduces balance faster", () => {
    const liab = {
      ...sampleLiabilities[0],
      extraPayments: [
        { id: "ep1", liabilityId: "liab-mortgage", year: 2026, type: "per_payment" as const, amount: 200 },
      ],
    };
    const result = amortizeLiability(liab, 2026);
    const baseline = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.annualPayment).toBeGreaterThan(baseline.annualPayment);
    expect(result.endingBalance).toBeLessThan(baseline.endingBalance);
  });

  it("lump sum reduces ending balance by the lump amount", () => {
    const liab = {
      ...sampleLiabilities[0],
      extraPayments: [
        { id: "ep1", liabilityId: "liab-mortgage", year: 2026, type: "lump_sum" as const, amount: 10000 },
      ],
    };
    const result = amortizeLiability(liab, 2026);
    const baseline = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.endingBalance).toBeCloseTo(baseline.endingBalance - 10000, 0);
  });

  it("extra payment in a different year has no effect", () => {
    const liab = {
      ...sampleLiabilities[0],
      extraPayments: [
        { id: "ep1", liabilityId: "liab-mortgage", year: 2030, type: "lump_sum" as const, amount: 50000 },
      ],
    };
    const result = amortizeLiability(liab, 2026);
    const baseline = amortizeLiability(sampleLiabilities[0], 2026);
    expect(result.endingBalance).toBeCloseTo(baseline.endingBalance, 0);
  });

  it("uses termMonths to determine end year", () => {
    const liab = {
      ...sampleLiabilities[0],
      termMonths: 12, // 1-year term
    };
    const result = amortizeLiability(liab, 2027);
    expect(result.annualPayment).toBe(0);
    expect(result.endingBalance).toBe(0);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/liabilities.test.ts`
Expected: FAIL — new tests fail (endYear no longer on type, extra payment logic not implemented)

- [ ] **Step 5: Update amortizeLiability and computeLiabilities**

Replace the entire contents of `src/engine/liabilities.ts`:

```typescript
import type { Liability } from "./types";

export interface AmortizationResult {
  annualPayment: number;
  interestPortion: number;
  principalPortion: number;
  endingBalance: number;
}

interface LiabilitiesResult {
  totalPayment: number;
  updatedLiabilities: Liability[];
  byLiability: Record<string, number>;
  interestByLiability: Record<string, number>;
}

export function amortizeLiability(
  liability: Liability,
  year: number
): AmortizationResult {
  const endYear =
    liability.startYear + Math.ceil(liability.termMonths / 12) - 1;

  if (
    year < liability.startYear ||
    year > endYear ||
    liability.balance <= 0
  ) {
    return {
      annualPayment: 0,
      interestPortion: 0,
      principalPortion: 0,
      endingBalance: 0,
    };
  }

  const interest = liability.balance * liability.interestRate;
  const scheduledPayment = liability.monthlyPayment * 12;
  const totalOwed = liability.balance + interest;
  const annualPayment = Math.min(scheduledPayment, totalOwed);
  const interestPortion = Math.min(interest, annualPayment);
  const principalFromPayment = annualPayment - interestPortion;

  // Extra payments for this year
  const extras = (liability.extraPayments ?? []).filter(
    (ep) => ep.year === year
  );
  const perPaymentExtra = extras
    .filter((ep) => ep.type === "per_payment")
    .reduce((sum, ep) => sum + ep.amount * 12, 0);
  const lumpSumExtra = extras
    .filter((ep) => ep.type === "lump_sum")
    .reduce((sum, ep) => sum + ep.amount, 0);

  const totalExtra = perPaymentExtra + lumpSumExtra;
  const totalPrincipal = Math.min(
    principalFromPayment + totalExtra,
    liability.balance
  );
  const endingBalance = Math.max(0, liability.balance - totalPrincipal);

  return {
    annualPayment: annualPayment + Math.min(totalExtra, liability.balance - principalFromPayment),
    interestPortion,
    principalPortion: totalPrincipal,
    endingBalance,
  };
}

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

- [ ] **Step 6: Update existing tests for termMonths**

In `src/engine/__tests__/liabilities.test.ts`, update the existing tests. The `sampleLiabilities[0]` now has `termMonths: 240` instead of `endYear: 2046`. The "outside range" test needs a year beyond `2026 + ceil(240/12) - 1 = 2045`:

Replace the "returns zero for years outside liability range" test:

```typescript
  it("returns zero for years outside liability range", () => {
    const result = amortizeLiability(sampleLiabilities[0], 2046);
    expect(result.annualPayment).toBe(0);
    expect(result.endingBalance).toBe(0);
  });
```

- [ ] **Step 7: Run all liabilities tests**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/liabilities.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Run the full test suite to check for breakage**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run`
Expected: Some tests may fail due to `endYear` references in projection tests and fixtures. Note which files fail — we fix them in the next steps.

- [ ] **Step 9: Fix any broken projection tests/fixtures**

Update any remaining references to `endYear` on Liability objects in:
- `src/engine/__tests__/fixtures.ts` — ensure `createProjectionInput` builds liabilities with `termMonths` and `extraPayments: []` instead of `endYear`
- `src/engine/__tests__/projection.test.ts` — update any inline liability objects
- `src/engine/projection.ts` — update any `liability.endYear` references to use `liability.startYear + Math.ceil(liability.termMonths / 12) - 1`

For each file, find `endYear` references on liability objects and replace with the `termMonths` equivalent. The exact changes depend on what the full test suite surfaces.

- [ ] **Step 10: Run the full test suite again**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run`
Expected: ALL PASS

- [ ] **Step 11: Commit**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add src/engine/types.ts src/engine/liabilities.ts src/engine/__tests__/fixtures.ts src/engine/__tests__/liabilities.test.ts src/engine/projection.ts src/engine/__tests__/projection.test.ts
git commit -m "feat: update engine liabilities for termMonths and extra payments"
```

---

## Task 3: Database Migration

Add `term_months`, `term_unit`, `extra_payments` table, backfill, drop `end_year`/`end_year_ref`.

**Files:**
- Create: `src/db/migrations/0019_liability_amortization.sql`
- Modify: `src/db/migrations/meta/_journal.json`
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- src/db/migrations/0019_liability_amortization.sql

-- 1. Add term columns
ALTER TABLE liabilities ADD COLUMN term_months integer;
ALTER TABLE liabilities ADD COLUMN term_unit text NOT NULL DEFAULT 'annual';

-- 2. Backfill term_months from existing end_year - start_year
UPDATE liabilities SET term_months = (end_year - start_year) * 12;

-- 3. Make term_months NOT NULL
ALTER TABLE liabilities ALTER COLUMN term_months SET NOT NULL;

-- 4. Drop end_year columns
ALTER TABLE liabilities DROP COLUMN end_year;
ALTER TABLE liabilities DROP COLUMN end_year_ref;

-- 5. Create extra_payment_type enum
DO $$ BEGIN
  CREATE TYPE extra_payment_type AS ENUM ('per_payment', 'lump_sum');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. Create extra_payments table
CREATE TABLE extra_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id uuid NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  year integer NOT NULL,
  type extra_payment_type NOT NULL,
  amount decimal(15, 2) NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  UNIQUE (liability_id, year, type)
);
```

- [ ] **Step 2: Register migration in journal**

In `src/db/migrations/meta/_journal.json`, add entry at index 19 following the existing pattern. Read the file first to get the exact format, then add:

```json
{
  "idx": 19,
  "version": "7",
  "when": 1713380000000,
  "tag": "0019_liability_amortization",
  "breakpoints": true
}
```

- [ ] **Step 3: Update schema.ts — modify liabilities table**

In `src/db/schema.ts`, in the liabilities table definition (lines 432-463):

Remove these lines:
```typescript
  endYear: integer("end_year").notNull(),
  endYearRef: yearRefEnum("end_year_ref"),
```

Add these lines (after `startYearRef`):
```typescript
  termMonths: integer("term_months").notNull(),
  termUnit: text("term_unit").notNull().default("annual"),
```

- [ ] **Step 4: Update schema.ts — add extra_payment_type enum and extra_payments table**

Add the enum after the existing enum definitions (after line ~141):

```typescript
export const extraPaymentTypeEnum = pgEnum("extra_payment_type", [
  "per_payment",
  "lump_sum",
]);
```

Add the table after the liabilities table definition:

```typescript
export const extraPayments = pgTable("extra_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  liabilityId: uuid("liability_id")
    .notNull()
    .references(() => liabilities.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  type: extraPaymentTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

- [ ] **Step 5: Apply migration to Neon database**

Read the database connection approach from an existing migration application (check `package.json` for a `db:migrate` script or similar). Apply using the project's standard method.

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx drizzle-kit push` (or the project's migration command)

- [ ] **Step 6: Commit**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add src/db/migrations/0019_liability_amortization.sql src/db/migrations/meta/_journal.json src/db/schema.ts
git commit -m "feat: migration 0019 — term_months, extra_payments table, drop end_year"
```

---

## Task 4: API Route Updates

Update liabilities CRUD for `termMonths`/`termUnit`, add extra payments CRUD, update projection data loading.

**Files:**
- Modify: `src/app/api/clients/[id]/liabilities/route.ts`
- Modify: `src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts`
- Create: `src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/route.ts`
- Create: `src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/[extraPaymentId]/route.ts`
- Modify: `src/app/api/clients/[id]/projection-data/route.ts`

- [ ] **Step 1: Update POST liabilities route**

In `src/app/api/clients/[id]/liabilities/route.ts`, update the POST handler body destructuring and insert:

Replace:
```typescript
    const {
      name,
      balance,
      interestRate,
      monthlyPayment,
      startYear,
      endYear,
      linkedPropertyId,
      ownerEntityId,
    } = body;
    const startYearRef = body.startYearRef ?? null;
    const endYearRef = body.endYearRef ?? null;

    if (!name || startYear == null || endYear == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
```

With:
```typescript
    const {
      name,
      balance,
      interestRate,
      monthlyPayment,
      startYear,
      termMonths,
      termUnit,
      linkedPropertyId,
      ownerEntityId,
    } = body;
    const startYearRef = body.startYearRef ?? null;

    if (!name || startYear == null || termMonths == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
```

Replace the insert values:
```typescript
      .values({
        clientId: id,
        scenarioId,
        name,
        balance: balance ?? "0",
        interestRate: interestRate ?? "0",
        monthlyPayment: monthlyPayment ?? "0",
        startYear: Number(startYear),
        termMonths: Number(termMonths),
        termUnit: termUnit ?? "annual",
        linkedPropertyId: linkedPropertyId ?? null,
        ownerEntityId: ownerEntityId ?? null,
        startYearRef,
        isInterestDeductible: body.isInterestDeductible ?? false,
      })
```

- [ ] **Step 2: Update PUT liabilities route**

In `src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts`, no structural change needed — the existing `...body` spread on the `.set()` call will handle the new fields. Just make sure the schema columns match.

- [ ] **Step 3: Create extra payments GET/POST route**

```typescript
// src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, liabilities, extraPayments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

type Params = { params: Promise<{ id: string; liabilityId: string }> };

async function verifyOwnership(clientId: string, liabilityId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;

  const [liab] = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));
  return !!liab;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, liabilityId } = await params;

    if (!(await verifyOwnership(id, liabilityId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(extraPayments)
      .where(eq(extraPayments.liabilityId, liabilityId));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET extra-payments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, liabilityId } = await params;

    if (!(await verifyOwnership(id, liabilityId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const { year, type, amount } = body;

    if (year == null || !type || amount == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [row] = await db
      .insert(extraPayments)
      .values({
        liabilityId,
        year: Number(year),
        type,
        amount: String(amount),
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST extra-payments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create extra payments PUT/DELETE route**

```typescript
// src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/[extraPaymentId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, liabilities, extraPayments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

type Params = {
  params: Promise<{ id: string; liabilityId: string; extraPaymentId: string }>;
};

async function verifyOwnership(clientId: string, liabilityId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return false;

  const [liab] = await db
    .select()
    .from(liabilities)
    .where(and(eq(liabilities.id, liabilityId), eq(liabilities.clientId, clientId)));
  return !!liab;
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, liabilityId, extraPaymentId } = await params;

    if (!(await verifyOwnership(id, liabilityId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();

    const [updated] = await db
      .update(extraPayments)
      .set({ ...body, updatedAt: new Date() })
      .where(
        and(
          eq(extraPayments.id, extraPaymentId),
          eq(extraPayments.liabilityId, liabilityId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT extra-payment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await getOrgId();
    const { id, liabilityId, extraPaymentId } = await params;

    if (!(await verifyOwnership(id, liabilityId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(extraPayments)
      .where(
        and(
          eq(extraPayments.id, extraPaymentId),
          eq(extraPayments.liabilityId, liabilityId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE extra-payment error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 5: Update projection-data route**

In `src/app/api/clients/[id]/projection-data/route.ts`:

Add import for `extraPayments` table:
```typescript
import { clients, scenarios, liabilities, extraPayments, /* ...existing imports */ } from "@/db/schema";
```

Add a query for extra payments alongside the existing parallel queries (around line 70):
```typescript
db.select().from(extraPayments),
```

Update the liabilities mapping (lines 281-292) to replace `endYear` with `termMonths` and attach extra payments:

```typescript
      liabilities: liabilityRows.map((l) => ({
        id: l.id,
        name: l.name,
        balance: parseFloat(l.balance),
        interestRate: parseFloat(l.interestRate),
        monthlyPayment: parseFloat(l.monthlyPayment),
        startYear: l.startYear,
        termMonths: l.termMonths,
        linkedPropertyId: l.linkedPropertyId ?? undefined,
        ownerEntityId: l.ownerEntityId ?? undefined,
        isInterestDeductible: l.isInterestDeductible,
        extraPayments: extraPaymentRows
          .filter((ep) => ep.liabilityId === l.id)
          .map((ep) => ({
            id: ep.id,
            liabilityId: ep.liabilityId,
            year: ep.year,
            type: ep.type,
            amount: parseFloat(ep.amount),
          })),
      })),
```

- [ ] **Step 6: Update deductions page**

In `src/app/(app)/clients/[id]/client-data/deductions/page.tsx` (lines ~80-93), update the `amortizeLiability` call to use `termMonths` instead of `endYear`:

Replace:
```typescript
          startYear: l.startYear,
          endYear: l.endYear,
```

With:
```typescript
          startYear: l.startYear,
          termMonths: (l.endYear - l.startYear) * 12,
          extraPayments: [],
```

Wait — after the migration, the DB won't have `endYear` anymore. Update to:

```typescript
          startYear: l.startYear,
          termMonths: l.termMonths,
          extraPayments: [],
```

- [ ] **Step 7: Commit**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add src/app/api/clients/[id]/liabilities/ src/app/api/clients/[id]/projection-data/route.ts "src/app/(app)/clients/[id]/client-data/deductions/page.tsx"
git commit -m "feat: update liabilities API for termMonths, add extra payments CRUD, update projection data"
```

---

## Task 5: Liability Form Update

Reorganize form fields, add term input with unit toggle, add calculator buttons.

**Files:**
- Modify: `src/components/forms/add-liability-form.tsx`

- [ ] **Step 1: Update LiabilityFormInitial interface**

In `src/components/forms/add-liability-form.tsx`, replace the interface (lines 9-22):

```typescript
export interface LiabilityFormInitial {
  id: string;
  name: string;
  balance: string;
  interestRate: string; // decimal fraction, e.g. "0.065"
  monthlyPayment: string;
  startYear: number;
  termMonths: number;
  termUnit: "monthly" | "annual";
  linkedPropertyId?: string | null;
  ownerEntityId?: string | null;
  startYearRef?: string | null;
  isInterestDeductible?: boolean;
}
```

- [ ] **Step 2: Add loan-math import and calculator state**

Add at the top of the file:

```typescript
import { calcPayment, calcTerm, calcRate } from "@/lib/loan-math";
```

Inside the component, add state for the new fields:

```typescript
  const [termValue, setTermValue] = useState(
    initial
      ? initial.termUnit === "annual"
        ? String(initial.termMonths / 12)
        : String(initial.termMonths)
      : ""
  );
  const [termUnit, setTermUnit] = useState<"monthly" | "annual">(
    initial?.termUnit ?? "annual"
  );
```

- [ ] **Step 3: Add calculator handler functions**

```typescript
  function handleCalcPayment() {
    const bal = parseFloat((document.querySelector('[name="balance"]') as HTMLInputElement)?.value);
    const rate = parseFloat((document.querySelector('[name="interestRate"]') as HTMLInputElement)?.value) / 100;
    const months = termUnit === "annual" ? parseInt(termValue) * 12 : parseInt(termValue);
    if (isNaN(bal) || isNaN(rate) || isNaN(months) || months <= 0) return;
    const pmt = calcPayment(bal, rate, months);
    const input = document.querySelector('[name="monthlyPayment"]') as HTMLInputElement;
    if (input) input.value = pmt.toFixed(2);
  }

  function handleCalcTerm() {
    const bal = parseFloat((document.querySelector('[name="balance"]') as HTMLInputElement)?.value);
    const rate = parseFloat((document.querySelector('[name="interestRate"]') as HTMLInputElement)?.value) / 100;
    const pmt = parseFloat((document.querySelector('[name="monthlyPayment"]') as HTMLInputElement)?.value);
    if (isNaN(bal) || isNaN(rate) || isNaN(pmt) || pmt <= 0) return;
    const months = calcTerm(bal, rate, pmt);
    if (months === Infinity) return;
    setTermValue(termUnit === "annual" ? String(Math.ceil(months / 12)) : String(months));
  }

  function handleCalcRate() {
    const bal = parseFloat((document.querySelector('[name="balance"]') as HTMLInputElement)?.value);
    const months = termUnit === "annual" ? parseInt(termValue) * 12 : parseInt(termValue);
    const pmt = parseFloat((document.querySelector('[name="monthlyPayment"]') as HTMLInputElement)?.value);
    if (isNaN(bal) || isNaN(months) || isNaN(pmt) || months <= 0 || pmt <= 0) return;
    const rate = calcRate(bal, months, pmt);
    if (rate === null) return;
    const input = document.querySelector('[name="interestRate"]') as HTMLInputElement;
    if (input) input.value = (rate * 100).toFixed(3);
  }
```

- [ ] **Step 4: Update handleSubmit to send termMonths/termUnit**

In `handleSubmit`, replace the body construction. Remove `endYear` and `endYearRef`, add:

```typescript
    const termMonths = termUnit === "annual"
      ? parseInt(termValue) * 12
      : parseInt(termValue);

    const body = {
      name: data.get("name") as string,
      balance: data.get("balance") as string,
      interestRate: String(Number(data.get("interestRate")) / 100),
      monthlyPayment: data.get("monthlyPayment") as string,
      startYear,
      termMonths,
      termUnit,
      linkedPropertyId: linkedPropertyId || null,
      ownerEntityId: ownerEntityId || null,
      startYearRef,
      isInterestDeductible,
    };
```

- [ ] **Step 5: Reorganize form fields in JSX**

Reorder the form fields to match the spec (name, balance, start year, term, interest rate, payment, linked property, entity, deductible). Add calculator buttons next to term, interest rate, and payment fields.

A calculator button looks like:
```tsx
<button
  type="button"
  onClick={handleCalcPayment}
  className="ml-1 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-blue-400"
  title="Calculate from balance, rate, and term"
>
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
    <path d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm1 3h6v2H7V5zm0 4h2v2H7V9zm0 4h2v2H7v-2zm4-4h2v2h-2V9zm0 4h2v2h-2v-2z" />
  </svg>
</button>
```

The term field includes a unit toggle:
```tsx
<div>
  <div className="flex items-center gap-2">
    <label className="block text-sm text-gray-400">Term</label>
    <button
      type="button"
      onClick={handleCalcTerm}
      className="ml-1 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-blue-400"
      title="Calculate from balance, rate, and payment"
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H6zm1 3h6v2H7V5zm0 4h2v2H7V9zm0 4h2v2H7v-2zm4-4h2v2h-2V9zm0 4h2v2h-2v-2z" />
      </svg>
    </button>
  </div>
  <div className="flex gap-2">
    <input
      type="number"
      value={termValue}
      onChange={(e) => setTermValue(e.target.value)}
      className="flex-1 rounded bg-gray-800 border border-gray-600 px-3 py-2 text-gray-100"
      min="1"
      required
    />
    <select
      value={termUnit}
      onChange={(e) => setTermUnit(e.target.value as "monthly" | "annual")}
      className="rounded bg-gray-800 border border-gray-600 px-2 py-2 text-gray-100"
    >
      <option value="annual">Years</option>
      <option value="monthly">Months</option>
    </select>
  </div>
</div>
```

Remove the End Year / `endYearRef` field entirely.

- [ ] **Step 6: Run dev server and verify form renders**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npm run dev`

Open a client's balance sheet, click "Add Liability" or edit an existing one. Verify:
- Fields appear in the new order
- Term field has the unit toggle
- Calculator buttons appear and compute correct values when the other fields are filled
- Form submits successfully

- [ ] **Step 7: Commit**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add src/components/forms/add-liability-form.tsx
git commit -m "feat: reorganize liability form with term input and calculator buttons"
```

---

## Task 6: Tabbed Liability Dialog

Convert the flat dialog into a two-tab layout (Details + Amortization).

**Files:**
- Modify: `src/components/add-liability-dialog.tsx`

- [ ] **Step 1: Add tab state and tabbed UI**

Rewrite `src/components/add-liability-dialog.tsx` to add tabs. The Details tab wraps the existing `AddLiabilityForm`. The Amortization tab is a placeholder that we fill in Task 7.

```typescript
"use client";

import { useState } from "react";
import AddLiabilityForm, { LiabilityFormInitial } from "./forms/add-liability-form";
import LiabilityAmortizationTab from "./liability-amortization-tab";

interface AddLiabilityDialogProps {
  clientId: string;
  realEstateAccounts?: { id: string; name: string }[];
  entities?: { id: string; name: string }[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editing?: LiabilityFormInitial;
  onRequestDelete?: () => void;
}

export default function AddLiabilityDialog({
  clientId,
  realEstateAccounts,
  entities,
  open,
  onOpenChange,
  editing,
  onRequestDelete,
}: AddLiabilityDialogProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = isControlled ? !!open : internalOpen;
  const isEdit = Boolean(editing);
  const [activeTab, setActiveTab] = useState<"details" | "amortization">("details");

  function close() {
    setActiveTab("details");
    if (isControlled) onOpenChange?.(false);
    else setInternalOpen(false);
  }

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setInternalOpen(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:bg-blue-900 hover:text-blue-400"
          aria-label="Add liability"
          title="Add liability"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {actualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative z-10 w-full max-w-2xl rounded-lg bg-gray-900 border border-gray-700 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {isEdit ? "Edit Liability" : "Add Liability"}
              </h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-200" aria-label="Close">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {isEdit && (
              <div className="mb-4 flex border-b border-gray-700">
                <button
                  className={`px-4 py-2 text-sm font-medium ${
                    activeTab === "details"
                      ? "border-b-2 border-blue-500 text-blue-400"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                  onClick={() => setActiveTab("details")}
                >
                  Details
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium ${
                    activeTab === "amortization"
                      ? "border-b-2 border-blue-500 text-blue-400"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                  onClick={() => setActiveTab("amortization")}
                >
                  Amortization
                </button>
              </div>
            )}

            {activeTab === "details" ? (
              <AddLiabilityForm
                clientId={clientId}
                realEstateAccounts={realEstateAccounts}
                entities={entities}
                mode={isEdit ? "edit" : "create"}
                initial={editing}
                onSuccess={close}
                onDelete={onRequestDelete}
              />
            ) : (
              <LiabilityAmortizationTab
                clientId={clientId}
                liability={editing!}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

Note: `max-w-lg` changed to `max-w-2xl` to accommodate the amortization table.

- [ ] **Step 2: Create stub amortization tab**

```typescript
// src/components/liability-amortization-tab.tsx
"use client";

import { LiabilityFormInitial } from "./forms/add-liability-form";

interface Props {
  clientId: string;
  liability: LiabilityFormInitial;
}

export default function LiabilityAmortizationTab({ clientId, liability }: Props) {
  return (
    <div className="text-gray-400 text-sm py-8 text-center">
      Amortization schedule loading...
    </div>
  );
}
```

- [ ] **Step 3: Update balance-sheet-view.tsx if needed**

Check if `balance-sheet-view.tsx` passes `endYear`/`endYearRef` when building the `editing` prop for the dialog. If so, update to pass `termMonths` and `termUnit` instead. The exact change depends on how the balance sheet constructs the `LiabilityFormInitial` — read the file and update accordingly.

- [ ] **Step 4: Update import wizard default**

In `src/components/import/review-step-liabilities.tsx`, if it sets a default `endYear`, change to set `termMonths: 360` and `termUnit: "annual"` instead.

- [ ] **Step 5: Run dev server and test tabbed dialog**

Verify:
- New liability → single form (no tabs)
- Edit liability → two tabs (Details, Amortization)
- Switching tabs preserves data
- Details tab works as before
- Amortization tab shows stub

- [ ] **Step 6: Commit**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add src/components/add-liability-dialog.tsx src/components/liability-amortization-tab.tsx src/components/balance-sheet-view.tsx src/components/import/review-step-liabilities.tsx
git commit -m "feat: tabbed liability dialog with Details and Amortization tabs"
```

---

## Task 7: Amortization Tab — Schedule Table, Extra Payments, Line Graph

The main UI feature: year-by-year amortization table with inline extra payment editing and a Chart.js line graph.

**Files:**
- Modify: `src/components/liability-amortization-tab.tsx` (replace stub)

- [ ] **Step 1: Implement the amortization tab with schedule table**

Replace the stub in `src/components/liability-amortization-tab.tsx`:

```typescript
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  computeAmortizationSchedule,
  type AmortizationScheduleRow,
  type ScheduleExtraPayment,
} from "@/lib/loan-math";
import { LiabilityFormInitial } from "./forms/add-liability-form";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface ExtraPaymentRow {
  id: string;
  liabilityId: string;
  year: number;
  type: "per_payment" | "lump_sum";
  amount: number;
}

interface Props {
  clientId: string;
  liability: LiabilityFormInitial;
}

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function LiabilityAmortizationTab({ clientId, liability }: Props) {
  const [extraPayments, setExtraPayments] = useState<ExtraPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const balance = parseFloat(liability.balance);
  const rate = parseFloat(liability.interestRate);
  const payment = parseFloat(liability.monthlyPayment);
  const startYear = liability.startYear;
  const termMonths = liability.termMonths;

  const epUrl = `/api/clients/${clientId}/liabilities/${liability.id}/extra-payments`;

  // Load extra payments on mount
  useEffect(() => {
    fetch(epUrl)
      .then((r) => r.json())
      .then((data) => {
        setExtraPayments(
          data.map((ep: any) => ({
            ...ep,
            amount: parseFloat(ep.amount),
          }))
        );
      })
      .finally(() => setLoading(false));
  }, [epUrl]);

  // Compute schedule
  const schedule = useMemo(
    () =>
      computeAmortizationSchedule(
        balance,
        rate,
        payment,
        startYear,
        termMonths,
        extraPayments.map((ep) => ({
          year: ep.year,
          type: ep.type,
          amount: ep.amount,
        }))
      ),
    [balance, rate, payment, startYear, termMonths, extraPayments]
  );

  // Chart data
  const chartData = useMemo(() => {
    let cumPrincipal = 0;
    let cumInterest = 0;
    const labels: string[] = [];
    const principalData: number[] = [];
    const interestData: number[] = [];

    for (const row of schedule) {
      cumPrincipal += row.principal + row.extraPayment;
      cumInterest += row.interest;
      labels.push(String(row.year));
      principalData.push(cumPrincipal);
      interestData.push(cumInterest);
    }

    return {
      labels,
      datasets: [
        {
          label: "Cumulative Principal",
          data: principalData,
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          tension: 0.3,
        },
        {
          label: "Cumulative Interest",
          data: interestData,
          borderColor: "#ef4444",
          backgroundColor: "rgba(239, 68, 68, 0.1)",
          tension: 0.3,
        },
      ],
    };
  }, [schedule]);

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: "top" as const, labels: { color: "#9ca3af" } },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: "#9ca3af" }, grid: { color: "#374151" } },
      y: {
        ticks: {
          color: "#9ca3af",
          callback: (v: any) => fmt(v),
        },
        grid: { color: "#374151" },
      },
    },
  };

  // Extra payment handlers
  const addExtraPayment = useCallback(
    async (year: number, type: "per_payment" | "lump_sum", amount: number) => {
      const res = await fetch(epUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, type, amount }),
      });
      if (res.ok) {
        const row = await res.json();
        setExtraPayments((prev) => [
          ...prev,
          { ...row, amount: parseFloat(row.amount) },
        ]);
      }
    },
    [epUrl]
  );

  const removeExtraPayment = useCallback(
    async (epId: string) => {
      const res = await fetch(`${epUrl}/${epId}`, { method: "DELETE" });
      if (res.ok) {
        setExtraPayments((prev) => prev.filter((ep) => ep.id !== epId));
      }
    },
    [epUrl]
  );

  // Inline extra payment editor state
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [epType, setEpType] = useState<"per_payment" | "lump_sum">("per_payment");
  const [epAmount, setEpAmount] = useState("");

  async function handleSaveExtra() {
    if (editingYear == null || !epAmount) return;
    await addExtraPayment(editingYear, epType, parseFloat(epAmount));
    setEditingYear(null);
    setEpAmount("");
  }

  if (loading) {
    return <div className="py-8 text-center text-gray-400 text-sm">Loading...</div>;
  }

  // Totals
  const totals = schedule.reduce(
    (acc, row) => ({
      payment: acc.payment + row.payment,
      interest: acc.interest + row.interest,
      principal: acc.principal + row.principal,
      extra: acc.extra + row.extraPayment,
    }),
    { payment: 0, interest: 0, principal: 0, extra: 0 }
  );

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto">
      {/* Line Graph */}
      <div className="rounded-lg bg-gray-800 p-4">
        <Line data={chartData} options={chartOptions} />
      </div>

      {/* Schedule Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-left text-xs text-gray-400">
              <th className="py-2 pr-3">Year</th>
              <th className="py-2 pr-3 text-right">Payment</th>
              <th className="py-2 pr-3 text-right">Interest</th>
              <th className="py-2 pr-3 text-right">Principal</th>
              <th className="py-2 pr-3 text-right">Extra</th>
              <th className="py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => {
              const yearExtras = extraPayments.filter((ep) => ep.year === row.year);
              return (
                <tr
                  key={row.year}
                  className={`border-b border-gray-800 ${
                    row.endingBalance === 0 ? "text-green-400" : ""
                  }`}
                >
                  <td className="py-1.5 pr-3">{row.year}</td>
                  <td className="py-1.5 pr-3 text-right">{fmt(row.payment)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmt(row.interest)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmt(row.principal)}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {yearExtras.length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        {fmt(row.extraPayment)}
                        {yearExtras.map((ep) => (
                          <button
                            key={ep.id}
                            onClick={() => removeExtraPayment(ep.id)}
                            className="text-red-400 hover:text-red-300 text-xs"
                            title={`Remove ${ep.type === "per_payment" ? "per-payment" : "lump sum"}: ${fmt(ep.amount)}`}
                          >
                            ×
                          </button>
                        ))}
                      </span>
                    ) : editingYear === row.year ? (
                      <div className="flex items-center gap-1">
                        <select
                          value={epType}
                          onChange={(e) => setEpType(e.target.value as any)}
                          className="rounded bg-gray-700 border border-gray-600 px-1 py-0.5 text-xs"
                        >
                          <option value="per_payment">Per payment</option>
                          <option value="lump_sum">Lump sum</option>
                        </select>
                        <input
                          type="number"
                          value={epAmount}
                          onChange={(e) => setEpAmount(e.target.value)}
                          className="w-20 rounded bg-gray-700 border border-gray-600 px-1 py-0.5 text-xs text-right"
                          placeholder="Amount"
                          autoFocus
                        />
                        <button
                          onClick={handleSaveExtra}
                          className="text-green-400 hover:text-green-300 text-xs"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setEditingYear(null)}
                          className="text-gray-400 hover:text-gray-300 text-xs"
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingYear(row.year)}
                        className="text-gray-500 hover:text-blue-400 text-xs"
                        title="Add extra payment"
                      >
                        + add
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 text-right">{fmt(row.endingBalance)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-600 font-medium text-gray-200">
              <td className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right">{fmt(totals.payment)}</td>
              <td className="py-2 pr-3 text-right">{fmt(totals.interest)}</td>
              <td className="py-2 pr-3 text-right">{fmt(totals.principal)}</td>
              <td className="py-2 pr-3 text-right">{fmt(totals.extra)}</td>
              <td className="py-2 text-right">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify Chart.js and react-chartjs-2 are installed**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && grep "react-chartjs-2\|chart.js" package.json`

If not installed: `npm install react-chartjs-2 chart.js`

The project already uses Chart.js for the cash flow chart, so these should be present.

- [ ] **Step 3: Run dev server and test the full flow**

Test the following:
1. Edit an existing liability → Amortization tab appears
2. Schedule table shows year-by-year breakdown
3. Line graph renders with principal and interest lines
4. Click "+ add" on a row → inline editor appears
5. Add a per-payment extra → table and graph update live
6. Add a lump sum extra → table and graph update live
7. Remove an extra payment → table and graph update
8. Verify totals row is correct
9. Add a large lump sum that causes early payoff → remaining rows disappear, payoff year turns green

- [ ] **Step 4: Commit**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add src/components/liability-amortization-tab.tsx
git commit -m "feat: amortization tab with schedule table, extra payments, and line graph"
```

---

## Task 8: Full Integration Test

Verify everything works end-to-end: form → API → engine → projection → cash flow report.

- [ ] **Step 1: Run the full test suite**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Manual integration test in browser**

1. Create a new liability: name "Test Mortgage", balance $300,000, rate 6.5%, calculate payment (should fill ~$1,896), term 30 years
2. Save → verify it appears on balance sheet
3. Edit → go to Amortization tab → verify 30-row schedule
4. Add a lump sum of $50,000 in year 3 → verify graph updates, payoff shortens
5. Navigate to cash flow report → verify liability payments appear in expenses
6. Navigate to deductions page → verify mortgage interest shows correctly
7. Delete the extra payment → verify schedule returns to original
8. Delete the liability → verify it's removed from balance sheet

- [ ] **Step 3: Fix any issues found during integration testing**

Address any bugs discovered during the manual test.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning
git add -A
git commit -m "fix: integration fixes for liability amortization feature"
```
