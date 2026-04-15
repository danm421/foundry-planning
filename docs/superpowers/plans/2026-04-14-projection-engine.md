# Projection Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure TypeScript cash flow projection engine that computes year-by-year financial projections from client data.

**Architecture:** The engine lives in `src/engine/` with zero React/Next.js/Node dependencies. Each concern (tax, income, expenses, liabilities, savings, withdrawals) is a pure function. The orchestrator `runProjection()` calls them in sequence per year. All types are already defined in `types.ts`.

**Tech Stack:** TypeScript, Vitest (test runner)

---

### Task 1: Set Up Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add test script + vitest devDep)

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add to `"scripts"` in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify vitest runs**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run`
Expected: "No test files found" (clean exit, no errors)

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

### Task 2: Test Fixtures

**Files:**
- Create: `src/engine/__tests__/fixtures.ts`

Shared test data used across all engine tests. Define once, import everywhere.

- [ ] **Step 1: Create test fixtures file**

Create `src/engine/__tests__/fixtures.ts`:

```typescript
import type {
  ClientData,
  ClientInfo,
  Account,
  Income,
  Expense,
  Liability,
  SavingsRule,
  WithdrawalPriority,
  PlanSettings,
} from "../types";

export const baseClient: ClientInfo = {
  name: "John Smith",
  dateOfBirth: "1970-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint",
  spouseName: "Jane Smith",
  spouseDob: "1972-06-15",
  spouseRetirementAge: 65,
};

export const basePlanSettings: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2055,
};

export const sampleAccounts: Account[] = [
  {
    id: "acct-401k",
    name: "John 401(k)",
    category: "retirement",
    subType: "401k",
    owner: "client",
    value: 500000,
    basis: 500000,
    growthRate: 0.07,
  },
  {
    id: "acct-roth",
    name: "Jane Roth IRA",
    category: "retirement",
    subType: "roth_ira",
    owner: "spouse",
    value: 200000,
    basis: 150000,
    growthRate: 0.07,
  },
  {
    id: "acct-brokerage",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    owner: "joint",
    value: 300000,
    basis: 200000,
    growthRate: 0.06,
  },
  {
    id: "acct-savings",
    name: "Emergency Fund",
    category: "cash",
    subType: "savings",
    owner: "joint",
    value: 50000,
    basis: 50000,
    growthRate: 0.04,
  },
];

export const sampleIncomes: Income[] = [
  {
    id: "inc-salary-john",
    type: "salary",
    name: "John Salary",
    annualAmount: 150000,
    startYear: 2026,
    endYear: 2035,
    growthRate: 0.03,
    owner: "client",
  },
  {
    id: "inc-salary-jane",
    type: "salary",
    name: "Jane Salary",
    annualAmount: 100000,
    startYear: 2026,
    endYear: 2037,
    growthRate: 0.03,
    owner: "spouse",
  },
  {
    id: "inc-ss-john",
    type: "social_security",
    name: "John SS",
    annualAmount: 36000,
    startYear: 2026,
    endYear: 2055,
    growthRate: 0.02,
    owner: "client",
    claimingAge: 67,
  },
];

export const sampleExpenses: Expense[] = [
  {
    id: "exp-living",
    type: "living",
    name: "Living Expenses",
    annualAmount: 80000,
    startYear: 2026,
    endYear: 2055,
    growthRate: 0.03,
  },
  {
    id: "exp-insurance",
    type: "insurance",
    name: "Life Insurance",
    annualAmount: 5000,
    startYear: 2026,
    endYear: 2045,
    growthRate: 0.02,
  },
];

export const sampleLiabilities: Liability[] = [
  {
    id: "liab-mortgage",
    name: "Mortgage",
    balance: 300000,
    interestRate: 0.065,
    monthlyPayment: 2500,
    startYear: 2026,
    endYear: 2046,
  },
];

export const sampleSavingsRules: SavingsRule[] = [
  {
    id: "sav-401k",
    accountId: "acct-401k",
    annualAmount: 23500,
    startYear: 2026,
    endYear: 2035,
    employerMatchPct: 0.5,
    employerMatchCap: 0.06,
    annualLimit: 23500,
  },
];

export const sampleWithdrawalStrategy: WithdrawalPriority[] = [
  { accountId: "acct-savings", priorityOrder: 1, startYear: 2026, endYear: 2055 },
  { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
  { accountId: "acct-401k", priorityOrder: 3, startYear: 2026, endYear: 2055 },
  { accountId: "acct-roth", priorityOrder: 4, startYear: 2026, endYear: 2055 },
];

export function buildClientData(overrides?: Partial<ClientData>): ClientData {
  return {
    client: baseClient,
    accounts: sampleAccounts,
    incomes: sampleIncomes,
    expenses: sampleExpenses,
    liabilities: sampleLiabilities,
    savingsRules: sampleSavingsRules,
    withdrawalStrategy: sampleWithdrawalStrategy,
    planSettings: basePlanSettings,
    ...overrides,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/engine/__tests__/fixtures.ts
git commit -m "test: add projection engine test fixtures"
```

---

### Task 3: Tax Module

**Files:**
- Modify: `src/engine/tax.ts`
- Create: `src/engine/__tests__/tax.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/__tests__/tax.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { calculateTaxes } from "../tax";
import { basePlanSettings } from "./fixtures";

describe("calculateTaxes", () => {
  it("applies combined federal + state rate to taxable income", () => {
    const tax = calculateTaxes(100000, basePlanSettings);
    // 22% federal + 5% state = 27%
    expect(tax).toBe(27000);
  });

  it("returns 0 for zero income", () => {
    expect(calculateTaxes(0, basePlanSettings)).toBe(0);
  });

  it("returns 0 for negative income", () => {
    expect(calculateTaxes(-5000, basePlanSettings)).toBe(0);
  });

  it("uses custom rates from settings", () => {
    const settings = { ...basePlanSettings, flatFederalRate: 0.10, flatStateRate: 0.03 };
    expect(calculateTaxes(200000, settings)).toBe(26000);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

The tax module already has the correct implementation from scaffolding. Run:

```bash
cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/tax.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/__tests__/tax.test.ts
git commit -m "test: add tax module tests"
```

---

### Task 4: Income Computation

**Files:**
- Create: `src/engine/income.ts`
- Create: `src/engine/__tests__/income.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/__tests__/income.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeIncome } from "../income";
import { sampleIncomes, baseClient } from "./fixtures";

describe("computeIncome", () => {
  it("sums active salary income for the year", () => {
    const result = computeIncome(sampleIncomes, 2026, baseClient);
    // John: 150000, Jane: 100000
    expect(result.salaries).toBe(250000);
    expect(result.total).toBe(250000);
  });

  it("applies growth rate in subsequent years", () => {
    const result = computeIncome(sampleIncomes, 2027, baseClient);
    // John: 150000 * 1.03 = 154500, Jane: 100000 * 1.03 = 103000
    expect(result.salaries).toBeCloseTo(257500, 0);
  });

  it("excludes income outside its start/end year range", () => {
    const result = computeIncome(sampleIncomes, 2036, baseClient);
    // John salary ends 2035, Jane salary still active
    // Jane: 100000 * 1.03^10 = 134391.64
    expect(result.salaries).toBeCloseTo(134391.64, 0);
  });

  it("delays social security until claiming age", () => {
    // John born 1970, claiming age 67 → starts 2037
    const before = computeIncome(sampleIncomes, 2036, baseClient);
    expect(before.socialSecurity).toBe(0);

    const after = computeIncome(sampleIncomes, 2037, baseClient);
    // SS: 36000 * 1.02^11 (11 years of COLA from 2026)
    expect(after.socialSecurity).toBeCloseTo(36000 * Math.pow(1.02, 11), 0);
  });

  it("returns all zeros when no income is active", () => {
    const result = computeIncome([], 2026, baseClient);
    expect(result.total).toBe(0);
    expect(result.salaries).toBe(0);
    expect(result.socialSecurity).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/income.test.ts`
Expected: FAIL — `computeIncome` is not exported from `../income`

- [ ] **Step 3: Implement income computation**

Replace `src/engine/income.ts` with:

```typescript
import type { Income, ClientInfo } from "./types";

interface IncomeBreakdown {
  salaries: number;
  socialSecurity: number;
  business: number;
  trust: number;
  deferred: number;
  capitalGains: number;
  other: number;
  total: number;
}

const incomeTypeToKey: Record<Income["type"], keyof Omit<IncomeBreakdown, "total">> = {
  salary: "salaries",
  social_security: "socialSecurity",
  business: "business",
  trust: "trust",
  deferred: "deferred",
  capital_gains: "capitalGains",
  other: "other",
};

export function computeIncome(
  incomes: Income[],
  year: number,
  client: ClientInfo
): IncomeBreakdown {
  const result: IncomeBreakdown = {
    salaries: 0,
    socialSecurity: 0,
    business: 0,
    trust: 0,
    deferred: 0,
    capitalGains: 0,
    other: 0,
    total: 0,
  };

  for (const inc of incomes) {
    if (year < inc.startYear || year > inc.endYear) continue;

    // Social Security: delay until claiming age
    if (inc.type === "social_security" && inc.claimingAge != null) {
      const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
      if (!ownerDob) continue;
      const birthYear = new Date(ownerDob).getFullYear();
      const claimingYear = birthYear + inc.claimingAge;
      if (year < claimingYear) continue;
    }

    const yearsElapsed = year - inc.startYear;
    const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, yearsElapsed);
    const key = incomeTypeToKey[inc.type];
    result[key] += amount;
  }

  result.total =
    result.salaries +
    result.socialSecurity +
    result.business +
    result.trust +
    result.deferred +
    result.capitalGains +
    result.other;

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/income.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/income.ts src/engine/__tests__/income.test.ts
git commit -m "feat: implement income computation with growth and SS claiming age"
```

---

### Task 5: Expense Computation

**Files:**
- Create: `src/engine/expenses.ts`
- Create: `src/engine/__tests__/expenses.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/__tests__/expenses.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeExpenses } from "../expenses";
import { sampleExpenses } from "./fixtures";

describe("computeExpenses", () => {
  it("sums active expenses by type for the year", () => {
    const result = computeExpenses(sampleExpenses, 2026);
    expect(result.living).toBe(80000);
    expect(result.insurance).toBe(5000);
    expect(result.total).toBe(85000);
  });

  it("applies growth rate in subsequent years", () => {
    const result = computeExpenses(sampleExpenses, 2027);
    expect(result.living).toBeCloseTo(80000 * 1.03, 0);
    expect(result.insurance).toBeCloseTo(5000 * 1.02, 0);
  });

  it("excludes expenses outside their year range", () => {
    // Insurance ends 2045
    const result = computeExpenses(sampleExpenses, 2046);
    expect(result.insurance).toBe(0);
    expect(result.living).toBeGreaterThan(0);
  });

  it("returns all zeros when no expenses active", () => {
    const result = computeExpenses([], 2026);
    expect(result.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/expenses.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement expense computation**

Create `src/engine/expenses.ts`:

```typescript
import type { Expense } from "./types";

interface ExpenseBreakdown {
  living: number;
  liabilities: number;
  other: number;
  insurance: number;
  total: number;
}

export function computeExpenses(
  expenses: Expense[],
  year: number
): ExpenseBreakdown {
  const result: ExpenseBreakdown = {
    living: 0,
    liabilities: 0,
    other: 0,
    insurance: 0,
    total: 0,
  };

  for (const exp of expenses) {
    if (year < exp.startYear || year > exp.endYear) continue;

    const yearsElapsed = year - exp.startYear;
    const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, yearsElapsed);
    result[exp.type] += amount;
  }

  // Liabilities are computed separately from the Liability table, not from Expense rows
  result.total = result.living + result.other + result.insurance;

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/expenses.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/expenses.ts src/engine/__tests__/expenses.test.ts
git commit -m "feat: implement expense computation with growth rates"
```

---

### Task 6: Liability Amortization

**Files:**
- Create: `src/engine/liabilities.ts`
- Create: `src/engine/__tests__/liabilities.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/__tests__/liabilities.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeLiabilities, amortizeLiability } from "../liabilities";
import { sampleLiabilities } from "./fixtures";

describe("amortizeLiability", () => {
  it("computes annual payment, interest, and principal split", () => {
    const result = amortizeLiability(sampleLiabilities[0], 2026);
    // $2500/mo = $30000/yr payment
    expect(result.annualPayment).toBe(30000);
    // Interest on 300000 at 6.5% = 19500
    expect(result.interestPortion).toBeCloseTo(19500, 0);
    // Principal = 30000 - 19500 = 10500
    expect(result.principalPortion).toBeCloseTo(10500, 0);
    expect(result.endingBalance).toBeCloseTo(289500, 0);
  });

  it("returns zero for years outside liability range", () => {
    const result = amortizeLiability(sampleLiabilities[0], 2047);
    expect(result.annualPayment).toBe(0);
    expect(result.endingBalance).toBe(0);
  });

  it("caps payment at remaining balance", () => {
    const smallLiability = {
      ...sampleLiabilities[0],
      balance: 1000,
      monthlyPayment: 5000,
    };
    const result = amortizeLiability(smallLiability, 2026);
    // Interest on 1000 at 6.5% = 65
    // Total owed = 1065, but monthly payment * 12 = 60000
    // Should cap at balance + interest
    expect(result.annualPayment).toBeCloseTo(1065, 0);
    expect(result.endingBalance).toBe(0);
  });
});

describe("computeLiabilities", () => {
  it("returns total annual liability payments and updated balances", () => {
    const result = computeLiabilities(sampleLiabilities, 2026);
    expect(result.totalPayment).toBe(30000);
    expect(result.updatedLiabilities).toHaveLength(1);
    expect(result.updatedLiabilities[0].balance).toBeCloseTo(289500, 0);
  });

  it("returns zero for empty liabilities", () => {
    const result = computeLiabilities([], 2026);
    expect(result.totalPayment).toBe(0);
    expect(result.updatedLiabilities).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/liabilities.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement liability amortization**

Create `src/engine/liabilities.ts`:

```typescript
import type { Liability } from "./types";

interface AmortizationResult {
  annualPayment: number;
  interestPortion: number;
  principalPortion: number;
  endingBalance: number;
}

interface LiabilitiesResult {
  totalPayment: number;
  updatedLiabilities: Liability[];
}

export function amortizeLiability(
  liability: Liability,
  year: number
): AmortizationResult {
  if (year < liability.startYear || year > liability.endYear || liability.balance <= 0) {
    return { annualPayment: 0, interestPortion: 0, principalPortion: 0, endingBalance: 0 };
  }

  const interest = liability.balance * liability.interestRate;
  const scheduledPayment = liability.monthlyPayment * 12;
  const totalOwed = liability.balance + interest;

  const annualPayment = Math.min(scheduledPayment, totalOwed);
  const interestPortion = Math.min(interest, annualPayment);
  const principalPortion = annualPayment - interestPortion;
  const endingBalance = Math.max(0, liability.balance - principalPortion);

  return { annualPayment, interestPortion, principalPortion, endingBalance };
}

export function computeLiabilities(
  liabilities: Liability[],
  year: number
): LiabilitiesResult {
  let totalPayment = 0;
  const updatedLiabilities: Liability[] = [];

  for (const liab of liabilities) {
    const result = amortizeLiability(liab, year);
    totalPayment += result.annualPayment;
    updatedLiabilities.push({ ...liab, balance: result.endingBalance });
  }

  return { totalPayment, updatedLiabilities };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/liabilities.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/liabilities.ts src/engine/__tests__/liabilities.test.ts
git commit -m "feat: implement liability amortization with annual payment split"
```

---

### Task 7: Savings Rule Application

**Files:**
- Create: `src/engine/savings.ts`
- Create: `src/engine/__tests__/savings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/__tests__/savings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applySavingsRules } from "../savings";
import { sampleSavingsRules, sampleIncomes } from "./fixtures";

describe("applySavingsRules", () => {
  it("applies employee contribution to the target account", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 50000, 150000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
  });

  it("calculates employer match (50% up to 6% of salary)", () => {
    // Employer match: 50% of employee contribution, capped at 6% of salary
    // Employee contributes 23500. 6% of 150000 = 9000. 50% of 9000 = 4500.
    const result = applySavingsRules(sampleSavingsRules, 2026, 50000, 150000);
    expect(result.employerTotal).toBe(4500);
  });

  it("caps contribution at available surplus", () => {
    // Only 5000 surplus available, but rule says 23500
    const result = applySavingsRules(sampleSavingsRules, 2026, 5000, 150000);
    expect(result.byAccount["acct-401k"]).toBe(5000);
    expect(result.total).toBe(5000);
  });

  it("caps contribution at annual limit", () => {
    const rules = [{ ...sampleSavingsRules[0], annualAmount: 50000, annualLimit: 23500 }];
    const result = applySavingsRules(rules, 2026, 100000, 150000);
    expect(result.byAccount["acct-401k"]).toBe(23500);
  });

  it("skips rules outside their year range", () => {
    const result = applySavingsRules(sampleSavingsRules, 2036, 50000, 150000);
    expect(result.total).toBe(0);
    expect(result.employerTotal).toBe(0);
  });

  it("returns zeros when no surplus", () => {
    const result = applySavingsRules(sampleSavingsRules, 2026, 0, 150000);
    expect(result.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/savings.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement savings rule application**

Create `src/engine/savings.ts`:

```typescript
import type { SavingsRule } from "./types";

interface SavingsResult {
  byAccount: Record<string, number>;
  total: number;
  employerTotal: number;
}

export function applySavingsRules(
  rules: SavingsRule[],
  year: number,
  availableSurplus: number,
  totalSalaryIncome: number
): SavingsResult {
  const byAccount: Record<string, number> = {};
  let total = 0;
  let employerTotal = 0;
  let remaining = Math.max(0, availableSurplus);

  for (const rule of rules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    if (remaining <= 0) break;

    let contribution = Math.min(rule.annualAmount, remaining);
    if (rule.annualLimit != null) {
      contribution = Math.min(contribution, rule.annualLimit);
    }

    byAccount[rule.accountId] = (byAccount[rule.accountId] ?? 0) + contribution;
    total += contribution;
    remaining -= contribution;

    // Employer match
    if (rule.employerMatchPct != null && rule.employerMatchCap != null) {
      const matchableAmount = totalSalaryIncome * rule.employerMatchCap;
      const employerMatch = matchableAmount * rule.employerMatchPct;
      employerTotal += employerMatch;
    }
  }

  return { byAccount, total, employerTotal };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/savings.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/savings.ts src/engine/__tests__/savings.test.ts
git commit -m "feat: implement savings rule application with employer match"
```

---

### Task 8: Withdrawal Strategy Execution

**Files:**
- Modify: `src/engine/withdrawal.ts`
- Create: `src/engine/__tests__/withdrawal.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/__tests__/withdrawal.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { executeWithdrawals } from "../withdrawal";
import { sampleWithdrawalStrategy } from "./fixtures";

describe("executeWithdrawals", () => {
  const balances: Record<string, number> = {
    "acct-savings": 50000,
    "acct-brokerage": 300000,
    "acct-401k": 500000,
    "acct-roth": 200000,
  };

  it("pulls from accounts in priority order", () => {
    const result = executeWithdrawals(30000, sampleWithdrawalStrategy, balances, 2026);
    // Priority 1 is savings (50000 available), deficit is 30000
    expect(result.byAccount["acct-savings"]).toBe(30000);
    expect(result.total).toBe(30000);
    expect(result.byAccount["acct-brokerage"]).toBeUndefined();
  });

  it("spills over to next account when first is exhausted", () => {
    const result = executeWithdrawals(70000, sampleWithdrawalStrategy, balances, 2026);
    // Savings: 50000 (exhausted), Brokerage: 20000
    expect(result.byAccount["acct-savings"]).toBe(50000);
    expect(result.byAccount["acct-brokerage"]).toBe(20000);
    expect(result.total).toBe(70000);
  });

  it("returns zero withdrawals when deficit is zero", () => {
    const result = executeWithdrawals(0, sampleWithdrawalStrategy, balances, 2026);
    expect(result.total).toBe(0);
  });

  it("caps at total available across all accounts", () => {
    const result = executeWithdrawals(2000000, sampleWithdrawalStrategy, balances, 2026);
    // Total across all accounts: 50k + 300k + 500k + 200k = 1050000
    expect(result.total).toBe(1050000);
  });

  it("skips accounts outside their year range", () => {
    const strategy = [
      { accountId: "acct-savings", priorityOrder: 1, startYear: 2030, endYear: 2055 },
      { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
    ];
    const result = executeWithdrawals(30000, strategy, balances, 2026);
    // Savings not available yet, should go to brokerage
    expect(result.byAccount["acct-savings"]).toBeUndefined();
    expect(result.byAccount["acct-brokerage"]).toBe(30000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/withdrawal.test.ts`
Expected: FAIL — current implementation returns empty object

- [ ] **Step 3: Implement withdrawal strategy**

Replace `src/engine/withdrawal.ts` with:

```typescript
import type { WithdrawalPriority } from "./types";

interface WithdrawalResult {
  byAccount: Record<string, number>;
  total: number;
}

export function executeWithdrawals(
  deficit: number,
  strategy: WithdrawalPriority[],
  accountBalances: Record<string, number>,
  year: number
): WithdrawalResult {
  const byAccount: Record<string, number> = {};
  let remaining = Math.max(0, deficit);

  if (remaining === 0) return { byAccount, total: 0 };

  const sorted = [...strategy]
    .filter((s) => year >= s.startYear && year <= s.endYear)
    .sort((a, b) => a.priorityOrder - b.priorityOrder);

  for (const entry of sorted) {
    if (remaining <= 0) break;

    const available = accountBalances[entry.accountId] ?? 0;
    if (available <= 0) continue;

    const withdrawal = Math.min(remaining, available);
    byAccount[entry.accountId] = withdrawal;
    remaining -= withdrawal;
  }

  const total = Object.values(byAccount).reduce((sum, v) => sum + v, 0);
  return { byAccount, total };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/withdrawal.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/withdrawal.ts src/engine/__tests__/withdrawal.test.ts
git commit -m "feat: implement withdrawal strategy with priority ordering"
```

---

### Task 9: Full Projection Orchestrator

**Files:**
- Modify: `src/engine/projection.ts`
- Create: `src/engine/__tests__/projection.test.ts`

This ties everything together. The orchestrator calls the sub-modules per year in the correct order.

- [ ] **Step 1: Write failing tests**

Create `src/engine/__tests__/projection.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";

describe("runProjection", () => {
  it("returns one ProjectionYear per year in the plan range", () => {
    const data = buildClientData();
    const result = runProjection(data);
    const expectedYears = data.planSettings.planEndYear - data.planSettings.planStartYear + 1;
    expect(result).toHaveLength(expectedYears);
    expect(result[0].year).toBe(2026);
    expect(result[result.length - 1].year).toBe(2055);
  });

  it("computes correct ages from DOB", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // John born 1970, year 2026 → age 56
    expect(result[0].ages.client).toBe(56);
    // Jane born 1972, year 2026 → age 54
    expect(result[0].ages.spouse).toBe(54);
  });

  it("computes income totals in year 1", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // John salary 150k + Jane salary 100k = 250k (SS not started yet)
    expect(result[0].income.salaries).toBe(250000);
    expect(result[0].income.socialSecurity).toBe(0);
    expect(result[0].income.total).toBe(250000);
  });

  it("includes liability payments in expenses", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // Mortgage: $2500/mo = $30000/yr
    expect(result[0].expenses.liabilities).toBe(30000);
  });

  it("computes taxes on taxable income", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // Taxable income = salaries = 250000, rate = 27%
    // (This is simplified — the actual taxable income depends on what's taxable)
    expect(result[0].expenses.taxes).toBeGreaterThan(0);
  });

  it("applies savings rules when there is a surplus", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // With 250k income and ~115k expenses+taxes, there should be a surplus
    expect(result[0].savings.total).toBeGreaterThan(0);
    expect(result[0].savings.byAccount["acct-401k"]).toBe(23500);
  });

  it("grows account balances year over year", () => {
    const data = buildClientData();
    const result = runProjection(data);
    // 401k starts at 500k, grows at 7%, plus contributions
    const yr1_401k = result[0].portfolioAssets.retirement["acct-401k"];
    expect(yr1_401k).toBeGreaterThan(500000);
  });

  it("produces account ledgers for each account each year", () => {
    const data = buildClientData();
    const result = runProjection(data);
    const ledger = result[0].accountLedgers["acct-401k"];
    expect(ledger).toBeDefined();
    expect(ledger.beginningValue).toBe(500000);
    expect(ledger.growth).toBeCloseTo(500000 * 0.07, 0);
    expect(ledger.endingValue).toBeGreaterThan(500000);
  });

  it("handles empty plan with no income, expenses, or accounts", () => {
    const data = buildClientData({
      accounts: [],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2028 },
    });
    const result = runProjection(data);
    expect(result).toHaveLength(3);
    expect(result[0].netCashFlow).toBe(0);
    expect(result[0].portfolioAssets.total).toBe(0);
  });

  it("triggers withdrawals when expenses exceed income in retirement", () => {
    const data = buildClientData({
      incomes: [], // No income — pure retirement
      planSettings: { ...basePlanSettings, planStartYear: 2040, planEndYear: 2042 },
    });
    const result = runProjection(data);
    // With expenses but no income, should trigger withdrawals
    if (result[0].expenses.total > 0) {
      expect(result[0].withdrawals.total).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run src/engine/__tests__/projection.test.ts`
Expected: FAIL — `runProjection` returns empty array

- [ ] **Step 3: Implement the full projection orchestrator**

Replace `src/engine/projection.ts` with:

```typescript
import type {
  ClientData,
  ProjectionYear,
  AccountLedger,
  Liability,
} from "./types";
import { computeIncome } from "./income";
import { computeExpenses } from "./expenses";
import { computeLiabilities } from "./liabilities";
import { calculateTaxes } from "./tax";
import { applySavingsRules } from "./savings";
import { executeWithdrawals } from "./withdrawal";

export function runProjection(data: ClientData): ProjectionYear[] {
  const { client, planSettings } = data;
  const years: ProjectionYear[] = [];

  // Mutable state that carries across years
  const accountBalances: Record<string, number> = {};
  for (const acct of data.accounts) {
    accountBalances[acct.id] = acct.value;
  }

  let currentLiabilities: Liability[] = data.liabilities.map((l) => ({ ...l }));

  const clientBirthYear = new Date(client.dateOfBirth).getFullYear();
  const spouseBirthYear = client.spouseDob
    ? new Date(client.spouseDob).getFullYear()
    : undefined;

  for (
    let year = planSettings.planStartYear;
    year <= planSettings.planEndYear;
    year++
  ) {
    const ages = {
      client: year - clientBirthYear,
      spouse: spouseBirthYear != null ? year - spouseBirthYear : undefined,
    };

    // 1. Compute income
    const income = computeIncome(data.incomes, year, client);

    // 2. Compute expenses (excluding liabilities and taxes)
    const expenseBreakdown = computeExpenses(data.expenses, year);

    // 3. Compute liability payments and update balances
    const liabResult = computeLiabilities(currentLiabilities, year);
    currentLiabilities = liabResult.updatedLiabilities;

    // 4. Grow accounts (beginning-of-year growth)
    const accountLedgers: Record<string, AccountLedger> = {};
    for (const acct of data.accounts) {
      const beginningValue = accountBalances[acct.id] ?? 0;
      const growth = beginningValue * acct.growthRate;
      accountLedgers[acct.id] = {
        beginningValue,
        growth,
        contributions: 0,
        distributions: 0,
        fees: 0,
        endingValue: beginningValue + growth,
      };
      accountBalances[acct.id] = beginningValue + growth;
    }

    // 5. Calculate taxes
    const taxableIncome =
      income.salaries +
      income.business +
      income.deferred +
      income.capitalGains +
      income.trust;
    const taxes = calculateTaxes(taxableIncome, planSettings);

    // 6. Determine net need
    const totalExpensesBeforeSavings =
      expenseBreakdown.living +
      expenseBreakdown.other +
      expenseBreakdown.insurance +
      liabResult.totalPayment +
      taxes;

    const netNeed = income.total - totalExpensesBeforeSavings;

    // 7. Apply savings or withdrawals
    let savings = { byAccount: {} as Record<string, number>, total: 0, employerTotal: 0 };
    let withdrawals = { byAccount: {} as Record<string, number>, total: 0 };

    if (netNeed > 0) {
      // Surplus — save
      savings = applySavingsRules(
        data.savingsRules,
        year,
        netNeed,
        income.salaries
      );

      // Apply contributions to account balances and ledgers
      for (const [acctId, amount] of Object.entries(savings.byAccount)) {
        accountBalances[acctId] = (accountBalances[acctId] ?? 0) + amount;
        if (accountLedgers[acctId]) {
          accountLedgers[acctId].contributions += amount;
          accountLedgers[acctId].endingValue += amount;
        }
      }

      // Apply employer match contributions
      if (savings.employerTotal > 0) {
        for (const rule of data.savingsRules) {
          if (year < rule.startYear || year > rule.endYear) continue;
          if (rule.employerMatchPct != null && rule.employerMatchCap != null) {
            const match = income.salaries * rule.employerMatchCap * rule.employerMatchPct;
            accountBalances[rule.accountId] = (accountBalances[rule.accountId] ?? 0) + match;
            if (accountLedgers[rule.accountId]) {
              accountLedgers[rule.accountId].contributions += match;
              accountLedgers[rule.accountId].endingValue += match;
            }
          }
        }
      }
    } else if (netNeed < 0) {
      // Deficit — withdraw
      withdrawals = executeWithdrawals(
        Math.abs(netNeed),
        data.withdrawalStrategy,
        accountBalances,
        year
      );

      // Apply withdrawals to account balances and ledgers
      for (const [acctId, amount] of Object.entries(withdrawals.byAccount)) {
        accountBalances[acctId] = (accountBalances[acctId] ?? 0) - amount;
        if (accountLedgers[acctId]) {
          accountLedgers[acctId].distributions += amount;
          accountLedgers[acctId].endingValue -= amount;
        }
      }
    }

    // 8. Build portfolio assets snapshot
    const portfolioAssets = {
      taxable: {} as Record<string, number>,
      cash: {} as Record<string, number>,
      retirement: {} as Record<string, number>,
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      total: 0,
    };

    for (const acct of data.accounts) {
      const val = accountBalances[acct.id] ?? 0;
      portfolioAssets[acct.category][acct.id] = val;
      if (acct.category === "taxable") portfolioAssets.taxableTotal += val;
      else if (acct.category === "cash") portfolioAssets.cashTotal += val;
      else if (acct.category === "retirement") portfolioAssets.retirementTotal += val;
    }
    portfolioAssets.total =
      portfolioAssets.taxableTotal +
      portfolioAssets.cashTotal +
      portfolioAssets.retirementTotal;

    // 9. Assemble the year
    const expenses = {
      living: expenseBreakdown.living,
      liabilities: liabResult.totalPayment,
      other: expenseBreakdown.other,
      insurance: expenseBreakdown.insurance,
      taxes,
      total: totalExpensesBeforeSavings,
    };

    const totalIncome = income.total + withdrawals.total;
    const totalExpenses = expenses.total + savings.total;
    const netCashFlow = totalIncome - totalExpenses;

    years.push({
      year,
      ages,
      income,
      withdrawals,
      expenses,
      savings,
      totalIncome,
      totalExpenses,
      netCashFlow,
      portfolioAssets,
      accountLedgers,
    });
  }

  return years;
}
```

- [ ] **Step 4: Run all tests**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run`
Expected: All tests pass across all test files

- [ ] **Step 5: Commit**

```bash
git add src/engine/projection.ts src/engine/__tests__/projection.test.ts
git commit -m "feat: implement full cash flow projection orchestrator"
```

---

### Task 10: Engine Index Export

**Files:**
- Create: `src/engine/index.ts`

- [ ] **Step 1: Create barrel export**

Create `src/engine/index.ts`:

```typescript
export { runProjection } from "./projection";
export { calculateTaxes } from "./tax";
export { computeIncome } from "./income";
export { computeExpenses } from "./expenses";
export { computeLiabilities, amortizeLiability } from "./liabilities";
export { applySavingsRules } from "./savings";
export { executeWithdrawals } from "./withdrawal";
export type {
  ClientData,
  ClientInfo,
  Account,
  Income,
  Expense,
  Liability,
  SavingsRule,
  WithdrawalPriority,
  PlanSettings,
  ProjectionYear,
  AccountLedger,
} from "./types";
```

- [ ] **Step 2: Verify all tests still pass**

Run: `cd /Users/dan-openclaw/Workspace/foundry-planning && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/index.ts
git commit -m "feat: add engine barrel export"
```
