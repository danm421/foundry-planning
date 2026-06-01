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
});
