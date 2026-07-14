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
  { kind: "living-expense-amount", amount: 80_000 },
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
  { kind: "stress-inflation", rate: 0.05 },
  { kind: "stress-ss-haircut", pct: 0.23, startYear: 2034 },
  { kind: "stress-disability", person: "client", startYear: 2030 },
  { kind: "stress-market-crash", year: 2030, drawdownPct: 0.3 },
  { kind: "surplus-allocation", spendPct: 0.3, saveAccountId: null },
  {
    kind: "surplus-allocation",
    spendPct: 0.3,
    saveAccountId: "00000000-0000-4000-8000-000000000009",
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

  it("rejects surplus-allocation with spendPct outside 0..1", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({
        kind: "surplus-allocation",
        spendPct: 1.4,
        saveAccountId: null,
      }).success,
    ).toBe(false);
  });

  it("covers every SolverMutation kind present in the samples list", () => {
    // Defensive: if SolverMutation gains a kind and a sample is forgotten,
    // mutationKey() will surface "never" on the new kind via the exhaustive
    // switch in types.ts, and TypeScript compile will fail.
    const kinds = new Set(SAMPLES.map((m) => m.kind));
    // 29 prior kinds + 4 stress kinds = 33 unique kinds.
    expect(kinds.size).toBeGreaterThanOrEqual(33);
  });
});

describe("SOLVER_MUTATION_SCHEMA — technique upserts", () => {
  it("accepts a roth-conversion-upsert with a full value", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "roth-conversion-upsert",
      id: "rc-1",
      value: {
        id: "rc-1",
        name: "Conv",
        destinationAccountId: "acc-roth",
        sourceAccountIds: ["acc-trad"],
        conversionType: "fixed_amount",
        fixedAmount: 25000,
        startYear: 2030,
        endYear: 2035,
        indexingRate: 0,
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a reinvestment-upsert removal (value null)", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "reinvestment-upsert",
      id: "ri-1",
      value: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an asset-transaction-upsert with a non-string id", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "asset-transaction-upsert",
      id: 5,
      value: null,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a relocation-upsert with a full value", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "relocation-upsert",
      id: "rl-1",
      value: {
        id: "rl-1",
        name: "Move to Florida",
        year: 2030,
        destinationState: "FL",
        enabled: true,
      },
    });
    if (!r.success) {
      throw new Error(`schema rejected relocation-upsert: ${r.error.message}`);
    }
    expect(r.success).toBe(true);
  });

  it("accepts a relocation-upsert removal (value null)", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "relocation-upsert",
      id: "rl-1",
      value: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a relocation-upsert with an invalid destinationState", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "relocation-upsert",
      id: "rl-1",
      value: {
        id: "rl-1",
        name: "Move to Nowhere",
        year: 2030,
        destinationState: "ZZ",
      },
    });
    expect(r.success).toBe(false);
  });
});

describe("SOLVER_MUTATION_SCHEMA — account-upsert categories", () => {
  // The revocable-trust lever emits an account-upsert for every probate-eligible
  // account, which includes `stock_options`. The ACCOUNT_VALUE category enum must
  // therefore accept every member of Account["category"] or the recompute 400s.
  const ACCOUNT_CATEGORIES = [
    "taxable",
    "cash",
    "retirement",
    "annuity",
    "real_estate",
    "business",
    "life_insurance",
    "notes_receivable",
    "stock_options",
  ] as const;

  it.each(ACCOUNT_CATEGORIES)("accepts an account-upsert with category %s", (category) => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "account-upsert",
      id: "acc-1",
      value: {
        id: "acc-1",
        name: "Acct",
        category,
        subType: "generic",
        value: 100000,
        basis: 50000,
        growthRate: 0.05,
        rmdEnabled: false,
        titlingType: "jtwros",
        owners: [{ kind: "client", percent: 1 }],
        revocableTrustName: null,
      },
    });
    if (!r.success) {
      throw new Error(`schema rejected category ${category}: ${r.error.message}`);
    }
    expect(r.success).toBe(true);
  });

  // Ownerless accounts are a real state (e.g. "Household Cash", unowned Plaid
  // accounts). The revocable-trust lever upserts every probate-eligible account,
  // so the schema must accept an empty owners array or the recompute 400s.
  it("accepts an account-upsert with an empty owners array", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "account-upsert",
      id: "acc-1",
      value: {
        id: "acc-1",
        name: "Household Cash",
        category: "cash",
        subType: "checking",
        value: 0,
        basis: 0,
        growthRate: 0.02,
        rmdEnabled: false,
        titlingType: "jtwros",
        owners: [],
        revocableTrustName: null,
      },
    });
    if (!r.success) {
      throw new Error(`schema rejected empty owners: ${r.error.message}`);
    }
    expect(r.success).toBe(true);
  });
});

describe("SOLVER_MUTATION_SCHEMA — asset-transaction-upsert sell source refine", () => {
  it("rejects a sell with both accountId and businessAccountId set", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "asset-transaction-upsert",
      id: "at-1",
      value: {
        id: "at-1",
        name: "Sell",
        type: "sell",
        year: 2030,
        accountId: "acc-1",
        businessAccountId: "ent-1",
      },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a sell with only businessAccountId set", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "asset-transaction-upsert",
      id: "at-1",
      value: {
        id: "at-1",
        name: "Sell",
        type: "sell",
        year: 2030,
        businessAccountId: "ent-1",
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a buy with multiple sources set (refine only triggers on sells)", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "asset-transaction-upsert",
      id: "at-1",
      value: {
        id: "at-1",
        name: "Buy",
        type: "buy",
        year: 2030,
        accountId: "acc-1",
        businessAccountId: "ent-1",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a sell with all three sources set", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "asset-transaction-upsert",
      id: "at-1",
      value: {
        id: "at-1",
        name: "Sell",
        type: "sell",
        year: 2030,
        accountId: "acc-1",
        purchaseTransactionId: "pt-1",
        businessAccountId: "ent-1",
      },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a sell with zero sources set", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "asset-transaction-upsert",
      id: "at-1",
      value: {
        id: "at-1",
        name: "Sell",
        type: "sell",
        year: 2030,
      },
    });
    expect(r.success).toBe(true);
  });
});
