import { describe, it, expect } from "vitest";
import {
  mutationsToBaseUpdates,
  isBaseSavableMutation,
} from "../mutations-to-base-updates";
import type { ClientData, Account, SavingsRule } from "@/engine/types";

const ACCT: Account = {
  id: "new", name: "John — Taxable", category: "taxable", subType: "brokerage",
  value: 0, basis: 0, growthRate: 0.06, rmdEnabled: false, titlingType: "jtwros",
  owners: [{ kind: "family_member", familyMemberId: "fm", percent: 100 }],
};
const source = { accounts: [], savingsRules: [] } as unknown as ClientData;

// Richer fixture for the field-edit + coalescing paths.
const RULE: SavingsRule = {
  id: "rule1", accountId: "acct1", annualAmount: 1000, startYear: 2026, endYear: 2040,
  isDeductible: true, applyContributionLimit: true, contributeMax: false,
} as unknown as SavingsRule;
const richSource = {
  client: {
    retirementAge: 65, spouseRetirementAge: 63, lifeExpectancy: 95, spouseLifeExpectancy: 92,
  },
  accounts: [{ id: "acct1" }],
  savingsRules: [RULE],
  incomes: [
    { id: "inc1", type: "salary", owner: "client", annualAmount: 200000 },
    { id: "ss1", type: "social_security", owner: "client", annualAmount: 0 },
  ],
  expenses: [
    { id: "exp-current", type: "living", annualAmount: 90000, startYear: 2026 },
    { id: "exp1", type: "living", annualAmount: 100000, startYear: 2030 },
    { id: "exp2", type: "other", annualAmount: 5000, startYear: 2026 },
  ],
  planSettings: { planStartYear: 2026 },
} as unknown as ClientData;

describe("mutationsToBaseUpdates", () => {
  it("classifies a brand-new account as an insert", () => {
    const out = mutationsToBaseUpdates(source, [
      { kind: "account-upsert", id: "new", value: ACCT },
    ]);
    expect(out.accountInserts).toHaveLength(1);
    expect(out.accountInserts[0].id).toBe("new");
    expect(out.accountUpdates).toHaveLength(0);
  });

  it("classifies an account already present in base as an update", () => {
    const out = mutationsToBaseUpdates({ ...source, accounts: [ACCT] } as ClientData, [
      { kind: "account-upsert", id: "new", value: { ...ACCT, name: "Renamed" } },
    ]);
    expect(out.accountInserts).toHaveLength(0);
    expect(out.accountUpdates).toHaveLength(1);
  });

  it("ignores a null (remove) value when the id is not in base", () => {
    const out = mutationsToBaseUpdates(source, [{ kind: "account-upsert", id: "new", value: null }]);
    expect(out.accountInserts).toHaveLength(0);
    expect(out.accountUpdates).toHaveLength(0);
    expect(out.accountRemoves).toHaveLength(0);
  });

  it("records a remove when a present account is upserted to null", () => {
    const out = mutationsToBaseUpdates({ ...source, accounts: [ACCT] } as ClientData, [
      { kind: "account-upsert", id: "new", value: null },
    ]);
    expect(out.accountRemoves).toEqual(["new"]);
  });

  it("coalesces client field edits into one partial update", () => {
    const out = mutationsToBaseUpdates(richSource, [
      { kind: "retirement-age", person: "client", age: 67 },
      { kind: "life-expectancy", person: "spouse", age: 90 },
    ]);
    expect(out.clientUpdate).toEqual({ retirementAge: 67, spouseLifeExpectancy: 90 });
  });

  it("emits a string-coerced annualAmount on an income edit", () => {
    const out = mutationsToBaseUpdates(richSource, [
      { kind: "income-annual-amount", incomeId: "inc1", annualAmount: 250000 },
    ]);
    expect(out.incomeUpdates).toEqual([{ id: "inc1", set: { annualAmount: "250000" } }]);
  });

  it("maps a Social Security lever onto the matching SS income row", () => {
    const out = mutationsToBaseUpdates(richSource, [
      { kind: "ss-pia-monthly", person: "client", amount: 3200 },
    ]);
    expect(out.incomeUpdates).toEqual([{ id: "ss1", set: { piaMonthly: "3200" } }]);
  });

  it("scales only retirement living expenses for living-expense-scale (current + non-living untouched)", () => {
    const out = mutationsToBaseUpdates(richSource, [
      { kind: "living-expense-scale", multiplier: 1.1 },
    ]);
    expect(out.expenseUpdates).toEqual([
      { id: "exp1", set: { annualAmount: String(100000 * 1.1) } },
    ]);
  });

  it("emits a partial savings update for a field edit on an existing rule", () => {
    const out = mutationsToBaseUpdates(richSource, [
      { kind: "savings-contribution", accountId: "acct1", annualAmount: 2500 },
    ]);
    expect(out.savingsFieldUpdates).toEqual([{ id: "rule1", set: { annualAmount: "2500" } }]);
  });

  it("folds a field edit into a fresh savings-rule insert (new account)", () => {
    const newRule = {
      id: "r2", accountId: "a2", annualAmount: 0, startYear: 2026, endYear: 2040,
      isDeductible: true, applyContributionLimit: true, contributeMax: false, rothPercent: null,
    } as unknown as SavingsRule;
    const out = mutationsToBaseUpdates(source, [
      { kind: "account-upsert", id: "a2", value: { ...ACCT, id: "a2" } },
      { kind: "savings-rule-upsert", id: "r2", value: newRule },
      { kind: "savings-roth-percent", accountId: "a2", rothPercent: 0.5 },
    ]);
    expect(out.savingsInserts).toHaveLength(1);
    expect(out.savingsInserts[0].rothPercent).toBe(0.5);
    expect(out.savingsFieldUpdates).toHaveLength(0);
  });
});

describe("living-expense-amount → base updates", () => {
  it("emits expense field updates for existing retirement rows", () => {
    const source = {
      planSettings: { planStartYear: 2026 },
      expenses: [{ id: "r1", type: "living", annualAmount: 40_000, startYear: 2040, endYear: 2070 }],
    } as unknown as ClientData;
    const out = mutationsToBaseUpdates(source, [
      { kind: "living-expense-amount", amount: 80_000 },
    ]);
    expect(out.expenseUpdates).toContainEqual({ id: "r1", set: { annualAmount: "80000" } });
    expect(out.expenseInserts).toHaveLength(0);
  });

  it("emits an expense insert when synthesizing (no retirement rows)", () => {
    const source = {
      planSettings: { planStartYear: 2026, planEndYear: 2070, inflationRate: 0.025 },
      client: { retirementAge: 65 },
      expenses: [],
    } as unknown as ClientData;
    const out = mutationsToBaseUpdates(source, [
      { kind: "living-expense-amount", amount: 70_000 },
    ]);
    expect(out.expenseInserts).toHaveLength(1);
    expect(out.expenseInserts[0].annualAmount).toBe(70_000);
    // Year-refs anchor the inserted row to retirement on reload (resolveRefYears).
    expect(out.expenseInserts[0].startYearRef).toBe("client_retirement");
    expect(out.expenseInserts[0].endYearRef).toBe("plan_end");
  });
});

describe("isBaseSavableMutation", () => {
  it("is true for retirement-tab levers", () => {
    expect(isBaseSavableMutation({ kind: "retirement-age", person: "client", age: 67 })).toBe(true);
    expect(isBaseSavableMutation({ kind: "account-upsert", id: "x", value: ACCT })).toBe(true);
  });

  it("is false for techniques and the engine-only self-employment flag", () => {
    expect(isBaseSavableMutation({ kind: "income-self-employment", incomeId: "i", value: true })).toBe(false);
    expect(isBaseSavableMutation({ kind: "roth-conversion-upsert", id: "r", value: null })).toBe(false);
    expect(isBaseSavableMutation({ kind: "asset-transaction-upsert", id: "t", value: null })).toBe(false);
    expect(isBaseSavableMutation({ kind: "reinvestment-upsert", id: "r", value: null })).toBe(false);
  });

  it("is false for estate/relocation/exemption techniques the base writer cannot persist", () => {
    // Regression for the data-loss/FK-crash: these kinds have no case in
    // mutationsToBaseUpdates, so they must not report base-savable.
    expect(isBaseSavableMutation({ kind: "gift-upsert", id: "g", value: null })).toBe(false);
    expect(isBaseSavableMutation({ kind: "external-beneficiary-upsert", id: "b", value: null })).toBe(false);
    expect(isBaseSavableMutation({ kind: "entity-upsert", id: "e", value: null })).toBe(false);
    expect(isBaseSavableMutation({ kind: "relocation-upsert", id: "r", value: null })).toBe(false);
    expect(isBaseSavableMutation({ kind: "stress-exemption-cap", cap: 5_000_000 })).toBe(false);
  });
});

// Completeness guard: every mutation kind that reports base-savable MUST produce
// at least one write in mutationsToBaseUpdates. If a new kind is added that is
// savable but unhandled by the switch, this fails (it would otherwise be a
// silent Save-to-base no-op) — see the NON_BASE_SAVABLE data-loss finding.
describe("every base-savable mutation kind produces a write", () => {
  const guardSource = {
    client: { retirementAge: 65, spouseRetirementAge: 63, lifeExpectancy: 95, spouseLifeExpectancy: 92 },
    accounts: [{ id: "acct1" }],
    savingsRules: [RULE],
    incomes: [
      { id: "inc1", type: "salary", owner: "client", annualAmount: 200000 },
      { id: "ss1", type: "social_security", owner: "client", annualAmount: 0 },
    ],
    expenses: [{ id: "exp1", type: "living", annualAmount: 100000, startYear: 2030 }],
    planSettings: { planStartYear: 2026 },
  } as unknown as ClientData;

  const representatives: Record<string, unknown> = {
    "retirement-age": { kind: "retirement-age", person: "client", age: 67 },
    "life-expectancy": { kind: "life-expectancy", person: "client", age: 90 },
    "living-expense-scale": { kind: "living-expense-scale", multiplier: 1.1 },
    "living-expense-amount": { kind: "living-expense-amount", amount: 80000 },
    "expense-annual-amount": { kind: "expense-annual-amount", expenseId: "exp1", annualAmount: 50000 },
    "income-annual-amount": { kind: "income-annual-amount", incomeId: "inc1", annualAmount: 1 },
    "income-growth-rate": { kind: "income-growth-rate", incomeId: "inc1", rate: 0.02 },
    "income-growth-source": { kind: "income-growth-source", incomeId: "inc1", source: "inflation" },
    "income-tax-type": { kind: "income-tax-type", incomeId: "inc1", taxType: "ordinary_income" },
    "income-start-year": { kind: "income-start-year", incomeId: "inc1", year: 2030 },
    "income-end-year": { kind: "income-end-year", incomeId: "inc1", year: 2050 },
    "ss-claim-age": { kind: "ss-claim-age", person: "client", age: 70 },
    "ss-claim-age-mode": { kind: "ss-claim-age-mode", person: "client", mode: "years" },
    "ss-benefit-mode": { kind: "ss-benefit-mode", person: "client", mode: "manual_amount" },
    "ss-pia-monthly": { kind: "ss-pia-monthly", person: "client", amount: 3200 },
    "ss-annual-amount": { kind: "ss-annual-amount", person: "client", amount: 20000 },
    "ss-cola": { kind: "ss-cola", person: "client", rate: 0.02 },
    "savings-contribution": { kind: "savings-contribution", accountId: "acct1", annualAmount: 2500 },
    "savings-annual-percent": { kind: "savings-annual-percent", accountId: "acct1", percent: 0.1 },
    "savings-roth-percent": { kind: "savings-roth-percent", accountId: "acct1", rothPercent: 0.5 },
    "savings-contribute-max": { kind: "savings-contribute-max", accountId: "acct1", value: true },
    "savings-growth-rate": { kind: "savings-growth-rate", accountId: "acct1", rate: 0.05 },
    "savings-growth-source": { kind: "savings-growth-source", accountId: "acct1", source: "inflation" },
    "savings-deductible": { kind: "savings-deductible", accountId: "acct1", value: false },
    "savings-apply-cap": { kind: "savings-apply-cap", accountId: "acct1", value: false },
    "savings-employer-match-pct": { kind: "savings-employer-match-pct", accountId: "acct1", pct: 0.05, cap: 1000 },
    "savings-employer-match-amount": { kind: "savings-employer-match-amount", accountId: "acct1", amount: 500 },
    "savings-start-year": { kind: "savings-start-year", accountId: "acct1", year: 2027 },
    "savings-end-year": { kind: "savings-end-year", accountId: "acct1", year: 2050 },
    "account-upsert": { kind: "account-upsert", id: "new", value: ACCT },
    "savings-rule-upsert": { kind: "savings-rule-upsert", id: "r2", value: { ...RULE, id: "r2", accountId: "acct1" } },
  };

  for (const [kind, m] of Object.entries(representatives)) {
    it(`writes something for base-savable kind '${kind}'`, () => {
      expect(isBaseSavableMutation(m as never)).toBe(true);
      const out = mutationsToBaseUpdates(guardSource, [m as never]);
      const total =
        out.accountInserts.length + out.accountUpdates.length + out.accountRemoves.length +
        out.savingsInserts.length + out.savingsUpdates.length + out.savingsRemoves.length +
        out.savingsFieldUpdates.length + (out.clientUpdate ? 1 : 0) +
        out.incomeUpdates.length + out.expenseUpdates.length + out.expenseInserts.length;
      expect(total).toBeGreaterThan(0);
    });
  }
});
