/**
 * Phase 2: business-as-asset account flow schedule overrides.
 *
 * When an account has `flowMode: "schedule"`, the engine reads
 * `data.accountFlowOverrides` for the year-by-year cells instead of summing
 * `incomes`/`expenses` rows with `ownerAccountId === business.id`. Blank cells
 * (no override row for the year, or null income/expense fields) resolve to $0.
 * A null `distributionPercent` falls back to `account.distributionPolicyPercent`
 * (or 1.0 if that's also null).
 *
 * Mirrors entity_flow_overrides semantics — see entity-cashflow.ts.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  AccountFlowOverride,
  ClientData,
  Income,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2027,
};

const client = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1980-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint" as const,
  spouseName: "Bob Test",
  spouseDob: "1980-06-01",
  spouseRetirementAge: 65,
};

const hhChecking: Account = {
  id: "hh-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
  isDefaultChecking: true,
};

const llcChecking: Account = {
  id: "biz-llc-checking",
  name: "LLC Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  parentAccountId: "biz-llc",
  owners: [{ kind: "entity", entityId: "biz-llc", percent: 1 }],
  isDefaultChecking: true,
};

function llcAccount(opts: {
  flowMode: "annual" | "schedule";
  distributionPolicyPercent?: number | null;
}): Account {
  return {
    id: "biz-llc",
    name: "Single-Owner LLC",
    category: "business",
    subType: "llc",
    titlingType: "jtwros",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    businessType: "llc",
    parentAccountId: null,
    distributionPolicyPercent: opts.distributionPolicyPercent ?? 1.0,
    flowMode: opts.flowMode,
    businessTaxTreatment: "ordinary",
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  } as Account;
}

const baseAnnualIncome: Income = {
  id: "i1",
  type: "business",
  name: "LLC Revenue",
  annualAmount: 50_000,
  startYear: 2026,
  endYear: 2050,
  growthRate: 0,
  owner: "client",
  ownerAccountId: "biz-llc",
};

function mkData(overrides: Partial<ClientData> = {}): ClientData {
  return {
    client,
    accounts: [hhChecking, llcAccount({ flowMode: "annual" }), llcChecking],
    incomes: [baseAnnualIncome],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [],
    entities: [],
    giftEvents: [],
    ...overrides,
  };
}

describe("Business-account schedule mode — tax incidence", () => {
  it("schedule mode with no overrides → net income = 0, no tax pass-through", () => {
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule" }), llcChecking],
      incomes: [baseAnnualIncome], // ignored in schedule mode
      accountFlowOverrides: [],
    });
    const y0 = runProjection(data)[0];

    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toBeUndefined();
    expect(y0.taxDetail!.ordinaryIncome).toBe(0);
  });

  it("schedule mode + income cell → cell drives K-1, ignores annual income row", () => {
    const overrides: AccountFlowOverride[] = [
      { accountId: "biz-llc", year: 2026, incomeAmount: 80_000, expenseAmount: null, distributionPercent: null },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule" }), llcChecking],
      incomes: [baseAnnualIncome], // $50k annual — should be ignored
      accountFlowOverrides: overrides,
    });
    const y0 = runProjection(data)[0];

    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toEqual({
      type: "ordinary_income",
      amount: 80_000, // schedule cell wins
    });
  });

  it("schedule mode + income & expense cells → net income = income - expense", () => {
    const overrides: AccountFlowOverride[] = [
      { accountId: "biz-llc", year: 2026, incomeAmount: 100_000, expenseAmount: 30_000, distributionPercent: null },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule" }), llcChecking],
      incomes: [],
      accountFlowOverrides: overrides,
    });
    const y0 = runProjection(data)[0];

    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toEqual({
      type: "ordinary_income",
      amount: 70_000,
    });
  });

  it("schedule mode + negative net → no tax incidence (P3-8 carries through)", () => {
    const overrides: AccountFlowOverride[] = [
      { accountId: "biz-llc", year: 2026, incomeAmount: 10_000, expenseAmount: 30_000, distributionPercent: null },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule" }), llcChecking],
      incomes: [],
      accountFlowOverrides: overrides,
    });
    const y0 = runProjection(data)[0];

    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toBeUndefined();
    expect(y0.taxDetail!.ordinaryIncome).toBe(0);
  });

  it("year without an override row in schedule mode → that year sees $0 net", () => {
    // Override exists for 2026 only; 2027 should resolve to 0.
    const overrides: AccountFlowOverride[] = [
      { accountId: "biz-llc", year: 2026, incomeAmount: 50_000, expenseAmount: null, distributionPercent: null },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule" }), llcChecking],
      incomes: [baseAnnualIncome],
      accountFlowOverrides: overrides,
    });
    const years = runProjection(data);

    expect(years[0].taxDetail!.bySource["business_passthrough:biz-llc"]).toEqual({
      type: "ordinary_income",
      amount: 50_000,
    });
    expect(years[1].taxDetail!.bySource["business_passthrough:biz-llc"]).toBeUndefined();
  });
});

describe("Business-account schedule mode — cash distribution", () => {
  it("schedule mode + income cell + 100% policy → distribution flows from business to owner", () => {
    const overrides: AccountFlowOverride[] = [
      { accountId: "biz-llc", year: 2026, incomeAmount: 60_000, expenseAmount: null, distributionPercent: null },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule", distributionPolicyPercent: 1.0 }), llcChecking],
      incomes: [],
      accountFlowOverrides: overrides,
    });
    const y0 = runProjection(data)[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    expect(distEntry!.amount).toBeCloseTo(60_000, 0);
    expect(distEntry!.sourceId).toBe("biz-llc");
  });

  it("schedule mode + per-year distribution_percent cell → cell wins over account policy", () => {
    const overrides: AccountFlowOverride[] = [
      // Account-level policy says 100%, but the year-cell forces 25%.
      { accountId: "biz-llc", year: 2026, incomeAmount: 100_000, expenseAmount: null, distributionPercent: 0.25 },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule", distributionPolicyPercent: 1.0 }), llcChecking],
      incomes: [],
      accountFlowOverrides: overrides,
    });
    const y0 = runProjection(data)[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    expect(distEntry).toBeDefined();
    // $100k net × 25% cell override = $25k distribution.
    expect(distEntry!.amount).toBeCloseTo(25_000, 0);
  });

  it("schedule mode + 0% distribution policy + no cell override → no distribution", () => {
    const overrides: AccountFlowOverride[] = [
      { accountId: "biz-llc", year: 2026, incomeAmount: 40_000, expenseAmount: null, distributionPercent: null },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "schedule", distributionPolicyPercent: 0 }), llcChecking],
      incomes: [],
      accountFlowOverrides: overrides,
    });
    const y0 = runProjection(data)[0];

    const hhEntries = y0.accountLedgers["hh-checking"].entries;
    const distEntry = hhEntries.find((e) => e.category === "entity_distribution");
    // Account policy = 0% and no per-year override → no distribution.
    expect(distEntry).toBeUndefined();
  });
});

describe("Business-account annual mode regression (Phase 1 + 2 should not drift)", () => {
  it("annual mode with the same income row → tax and distribution match pre-Phase-2 behavior", () => {
    // Same data shape as the base passthrough test (which is locked elsewhere).
    const data = mkData(); // defaults to annual mode, $50k income
    const y0 = runProjection(data)[0];

    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toEqual({
      type: "ordinary_income",
      amount: 50_000,
    });
  });

  it("annual mode ignores accountFlowOverrides entirely", () => {
    const overrides: AccountFlowOverride[] = [
      // Even if overrides exist, annual mode shouldn't read them.
      { accountId: "biz-llc", year: 2026, incomeAmount: 999_999, expenseAmount: null, distributionPercent: null },
    ];
    const data = mkData({
      accounts: [hhChecking, llcAccount({ flowMode: "annual" }), llcChecking],
      accountFlowOverrides: overrides,
    });
    const y0 = runProjection(data)[0];

    expect(y0.taxDetail!.bySource["business_passthrough:biz-llc"]).toEqual({
      type: "ordinary_income",
      amount: 50_000, // annual row, not the override
    });
  });
});
