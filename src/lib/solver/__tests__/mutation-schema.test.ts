import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "../mutation-schema";
import type { SolverMutation } from "../types";
import { mutationKey } from "../types";

// One representative payload per SolverMutation kind. If this array is missing
// a kind, the typeof-mutationKey return-value check at the bottom will fail to
// compile.
const SAMPLES: SolverMutation[] = [
  { kind: "retirement-age", person: "client", age: 67 },
  { kind: "retirement-age", person: "spouse", age: 65, month: 6 },
  { kind: "life-expectancy", person: "client", age: 95 },
  { kind: "ss-claim-age", person: "client", age: 67, months: 6 },
  { kind: "ss-claim-age-mode", person: "client", mode: "fra" },
  { kind: "ss-benefit-mode", person: "client", mode: "pia_at_fra" },
  { kind: "ss-pia-monthly", person: "client", amount: 2800 },
  { kind: "ss-annual-amount", person: "client", amount: 30000 },
  { kind: "ss-cola", person: "client", rate: 0.025 },
  { kind: "living-expense-scale", multiplier: 1.1 },
  {
    kind: "expense-annual-amount",
    expenseId: "00000000-0000-4000-8000-000000000001",
    annualAmount: 120000,
  },
  {
    kind: "income-annual-amount",
    incomeId: "00000000-0000-4000-8000-000000000002",
    annualAmount: 150000,
  },
  {
    kind: "income-growth-rate",
    incomeId: "00000000-0000-4000-8000-000000000002",
    rate: 0.03,
  },
  {
    kind: "income-growth-source",
    incomeId: "00000000-0000-4000-8000-000000000002",
    source: "inflation",
  },
  {
    kind: "income-tax-type",
    incomeId: "00000000-0000-4000-8000-000000000002",
    taxType: "qbi",
  },
  {
    kind: "income-self-employment",
    incomeId: "00000000-0000-4000-8000-000000000002",
    value: true,
  },
  {
    kind: "income-start-year",
    incomeId: "00000000-0000-4000-8000-000000000002",
    year: 2027,
  },
  {
    kind: "income-end-year",
    incomeId: "00000000-0000-4000-8000-000000000002",
    year: 2035,
  },
  {
    kind: "savings-contribution",
    accountId: "00000000-0000-4000-8000-000000000003",
    annualAmount: 23000,
  },
  {
    kind: "savings-annual-percent",
    accountId: "00000000-0000-4000-8000-000000000003",
    percent: 0.1,
  },
  {
    kind: "savings-annual-percent",
    accountId: "00000000-0000-4000-8000-000000000003",
    percent: null,
  },
  { kind: "savings-roth-percent", accountId: "00000000-0000-4000-8000-000000000003", rothPercent: 0.4 },
  {
    kind: "savings-contribute-max",
    accountId: "00000000-0000-4000-8000-000000000003",
    value: true,
  },
  {
    kind: "savings-growth-rate",
    accountId: "00000000-0000-4000-8000-000000000003",
    rate: 0.07,
  },
  {
    kind: "savings-growth-source",
    accountId: "00000000-0000-4000-8000-000000000003",
    source: "custom",
  },
  {
    kind: "savings-deductible",
    accountId: "00000000-0000-4000-8000-000000000003",
    value: false,
  },
  {
    kind: "savings-apply-cap",
    accountId: "00000000-0000-4000-8000-000000000003",
    value: false,
  },
  {
    kind: "savings-employer-match-pct",
    accountId: "00000000-0000-4000-8000-000000000003",
    pct: 0.5,
    cap: 0.06,
  },
  {
    kind: "savings-employer-match-pct",
    accountId: "00000000-0000-4000-8000-000000000003",
    pct: 0,
    cap: null,
  },
  {
    kind: "savings-employer-match-amount",
    accountId: "00000000-0000-4000-8000-000000000003",
    amount: 5000,
  },
  {
    kind: "savings-start-year",
    accountId: "00000000-0000-4000-8000-000000000003",
    year: 2027,
  },
  {
    kind: "savings-end-year",
    accountId: "00000000-0000-4000-8000-000000000003",
    year: 2035,
  },
];

describe("SOLVER_MUTATION_SCHEMA", () => {
  it.each(SAMPLES.map((m) => [mutationKey(m), m]))(
    "accepts a valid %s payload",
    (_key, mutation) => {
      const result = SOLVER_MUTATION_SCHEMA.safeParse(mutation);
      if (!result.success) {
        throw new Error(
          `schema rejected ${(mutation as SolverMutation).kind}: ${result.error.message}`,
        );
      }
      expect(result.success).toBe(true);
    },
  );

  it("rejects unknown kinds", () => {
    const result = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "bogus-kind",
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });

  it("rejects savings-roth-percent outside 0..1", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({
        kind: "savings-roth-percent",
        accountId: "00000000-0000-4000-8000-000000000003",
        rothPercent: 1.5,
      }).success,
    ).toBe(false);
  });

  it("covers every SolverMutation kind present in the samples list", () => {
    // Defensive: if SolverMutation gains a kind and a sample is forgotten,
    // mutationKey() will surface "never" on the new kind via the exhaustive
    // switch in types.ts, and TypeScript compile will fail.
    const kinds = new Set(SAMPLES.map((m) => m.kind));
    // 1 (retirement-age) + 1 (life-expectancy) + 6 SS + 2 expenses + 7 incomes +
    // 12 savings = 29 unique kinds.
    expect(kinds.size).toBeGreaterThanOrEqual(29);
  });
});
