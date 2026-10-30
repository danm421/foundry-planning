// Withdrawal methods (spec 2026-10-29): the group order, exclusions, and the
// split / proportional allocations, first at the planner, then through a
// whole projection.
import { describe, it, expect } from "vitest";
import { planSupplementalWithdrawal } from "../withdrawal";
import { buildDefaultWithdrawalStrategy, runProjection } from "../projection";
import { parseWithdrawalPolicy, type WithdrawalPolicy } from "../withdrawal-policy";
import { buildClientData, basePlanSettings } from "./fixtures";
import type { Account, PlanSettings, WithdrawalPriority } from "../types";

const acct = (id: string, overrides: Partial<Account>): Account => ({
  id, name: id, category: "cash", subType: "savings", titlingType: "jtwros",
  value: 0, basis: 0, growthRate: 0, rmdEnabled: false, owners: [],
  ...overrides,
});

const settings = { planStartYear: 2026, planEndYear: 2060 } as PlanSettings;
const policy = (raw: Record<string, unknown>): WithdrawalPolicy => parseWithdrawalPolicy(raw)!;

const cash = acct("cash", { category: "cash", value: 5_000 });
const brokerage = acct("brokerage", { category: "taxable", subType: "brokerage", value: 100_000, basis: 100_000 });
const ira = acct("ira", { category: "retirement", subType: "traditional_ira", value: 100_000 });
const roth = acct("roth", { category: "retirement", subType: "roth_ira", value: 100_000, basis: 100_000 });

function plan(
  accounts: Account[],
  shortfall: number,
  strategy: WithdrawalPriority[],
  allocation?: Parameters<typeof planSupplementalWithdrawal>[0]["allocation"],
  clientAge = 70,
) {
  return planSupplementalWithdrawal({
    shortfall, strategy, allocation,
    householdBalances: Object.fromEntries(accounts.map((a) => [a.id, a.value])),
    basisMap: Object.fromEntries(accounts.map((a) => [a.id, a.basis])),
    accounts, ages: { client: clientAge, spouse: null }, isSpouseAccount: () => false, year: 2030,
  });
}

describe("buildDefaultWithdrawalStrategy with a policy", () => {
  const accounts = [cash, brokerage, ira, roth];

  it("with no policy ranks the groups exactly as before", () => {
    const ranks = Object.fromEntries(
      buildDefaultWithdrawalStrategy(accounts, settings).map((s) => [s.accountId, s.priorityOrder]),
    );
    expect(ranks).toEqual({ cash: 1, brokerage: 2, ira: 3, roth: 4 });
  });

  it("ranks the groups in the policy's order", () => {
    const strategy = buildDefaultWithdrawalStrategy(
      accounts, settings, policy({ method: "order", groupOrder: ["roth", "tax_deferred", "taxable", "cash", "annuity"] }),
    );
    expect(strategy.map((s) => s.accountId)).toEqual(["roth", "ira", "brokerage", "cash"]);
  });

  it("leaves excluded accounts out", () => {
    const strategy = buildDefaultWithdrawalStrategy(
      accounts, settings, policy({ method: "order", excludedAccountIds: ["brokerage", "cash"] }),
    );
    expect(strategy.map((s) => s.accountId)).toEqual(["ira", "roth"]);
  });
});

describe("planSupplementalWithdrawal — split", () => {
  const accounts = [cash, brokerage, ira, roth];
  const strategy = buildDefaultWithdrawalStrategy(accounts, settings);
  const split = (splitPct: Record<string, number>) => ({
    method: "split" as const,
    splitPct,
    groupOrder: ["cash", "taxable", "tax_deferred", "roth", "annuity"] as WithdrawalPolicy["groupOrder"],
  });

  it("splits the draw across the groups by their shares", () => {
    const p = plan(accounts, 10_000, strategy, split({ taxable: 0.6, tax_deferred: 0.4 }));
    expect(p.total).toBeCloseTo(10_000, 6);
    expect(p.byAccount.brokerage).toBeCloseTo(6_000, 6);
    expect(p.byAccount.ira).toBeCloseTo(4_000, 6);
    // A 0% group (cash, Roth) is not touched while the split groups hold money.
    expect(p.byAccount.cash).toBeUndefined();
    expect(p.byAccount.roth).toBeUndefined();
    expect(p.recognizedIncome.ordinaryIncome).toBeCloseTo(4_000, 6);
  });

  // Spec: a 0% group is used only after the others run out — so a group's
  // unmet share goes to the other split groups first, even when a 0% group
  // (cash here) sits higher in the order.
  it("a group that runs out passes the rest to the other split groups before any 0% group", () => {
    const thin = acct("brokerage", { category: "taxable", subType: "brokerage", value: 3_000, basis: 3_000 });
    const p = plan([cash, thin, ira, roth], 10_000, buildDefaultWithdrawalStrategy([cash, thin, ira, roth], settings),
      split({ taxable: 0.5, tax_deferred: 0.5 }));
    expect(p.byAccount.brokerage).toBeCloseTo(3_000, 6);
    expect(p.byAccount.ira).toBeCloseTo(7_000, 6);
    expect(p.byAccount.cash).toBeUndefined();
    expect(p.total).toBeCloseTo(10_000, 6);
    expect(new Set(p.draws.map((d) => d.accountId)).size).toBe(p.draws.length);
  });

  it("the reviewer's case: cash first in the order stays untouched while tax-deferred holds money", () => {
    const savings = acct("cash", { category: "cash", value: 50_000 });
    const small = acct("brokerage", { category: "taxable", subType: "brokerage", value: 20_000, basis: 20_000 });
    const big = acct("ira", { category: "retirement", subType: "traditional_ira", value: 500_000 });
    const accts = [savings, small, big];
    const p = plan(accts, 100_000, buildDefaultWithdrawalStrategy(accts, settings), split({ taxable: 0.5, tax_deferred: 0.5 }));
    expect(p.byAccount.brokerage).toBeCloseTo(20_000, 6);
    expect(p.byAccount.ira).toBeCloseTo(80_000, 6);
    expect(p.byAccount.cash).toBeUndefined();
  });

  it("covers a shortfall bigger than the split groups from the 0% groups", () => {
    const p = plan(accounts, 250_000, strategy, split({ taxable: 0.5, tax_deferred: 0.5 }));
    expect(p.byAccount.brokerage).toBeCloseTo(100_000, 6);
    expect(p.byAccount.ira).toBeCloseTo(100_000, 6);
    expect(p.byAccount.cash).toBeCloseTo(5_000, 6);
    expect(p.byAccount.roth).toBeCloseTo(45_000, 6);
  });
});

describe("planSupplementalWithdrawal — proportional", () => {
  it("draws from every account in proportion to its balance", () => {
    const big = acct("brokerage", { category: "taxable", subType: "brokerage", value: 300_000, basis: 300_000 });
    const accounts = [big, ira];
    const p = plan(accounts, 8_000, buildDefaultWithdrawalStrategy(accounts, settings), { method: "proportional" });
    expect(p.byAccount.brokerage).toBeCloseTo(6_000, 6);
    expect(p.byAccount.ira).toBeCloseTo(2_000, 6);
  });

  it("never draws a pre-65 HSA", () => {
    const hsa = acct("hsa", { category: "retirement", subType: "hsa", value: 100_000 });
    const accounts = [brokerage, hsa];
    const p = plan(accounts, 10_000, buildDefaultWithdrawalStrategy(accounts, settings), { method: "proportional" }, 50);
    expect(p.byAccount.hsa).toBeUndefined();
    expect(p.byAccount.brokerage).toBeCloseTo(10_000, 6);
  });

  it("takes everything when the shortfall is larger than every account", () => {
    const accounts = [cash, ira];
    const p = plan(accounts, 1_000_000, buildDefaultWithdrawalStrategy(accounts, settings), { method: "proportional" });
    expect(p.byAccount.cash).toBeCloseTo(5_000, 6);
    expect(p.byAccount.ira).toBeCloseTo(100_000, 6);
    expect(p.total).toBeCloseTo(105_000, 6);
  });
});

describe("runProjection with a withdrawal policy", () => {
  // No account-by-account rows, so the plan runs the policy.
  const run = (withdrawalPolicy?: WithdrawalPolicy) =>
    runProjection(buildClientData({
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, ...(withdrawalPolicy ? { withdrawalPolicy } : {}) },
    }));
  const drawn = (years: ReturnType<typeof run>, id: string) =>
    years.reduce((s, y) => s + (y.withdrawals.byAccount[id] ?? 0), 0);

  const baseline = run();

  it("the fixture draws on its accounts at all (else these tests prove nothing)", () => {
    expect(baseline.some((y) => y.withdrawals.total > 0)).toBe(true);
    expect(drawn(baseline, "acct-brokerage")).toBeGreaterThan(0);
  });

  it("an explicit default policy projects exactly like no policy", () => {
    expect(run(policy({ method: "order" }))).toEqual(baseline);
  });

  it("an excluded account is never sold", () => {
    const years = run(policy({ method: "order", excludedAccountIds: ["acct-brokerage"] }));
    expect(drawn(years, "acct-brokerage")).toBe(0);
    expect(drawn(years, "acct-401k")).toBeGreaterThan(drawn(baseline, "acct-401k"));
  });

  it("a split draws taxable and tax-deferred in the same year", () => {
    const years = run(policy({ method: "split", splitPct: { taxable: 0.5, tax_deferred: 0.5 } }));
    const both = years.find(
      (y) => (y.withdrawals.byAccount["acct-brokerage"] ?? 0) > 0 && (y.withdrawals.byAccount["acct-401k"] ?? 0) > 0,
    );
    expect(both).toBeDefined();
    expect(both!.withdrawals.byAccount["acct-brokerage"]).toBeCloseTo(both!.withdrawals.byAccount["acct-401k"], 0);
  });

  it("In order ignores the account-by-account rows; Account by account uses them", () => {
    const rows: WithdrawalPriority[] = [
      { accountId: "acct-roth", priorityOrder: 1, startYear: 2026, endYear: 2055 },
    ];
    const withRows = (withdrawalPolicy?: WithdrawalPolicy) =>
      runProjection(buildClientData({
        withdrawalStrategy: rows,
        planSettings: { ...basePlanSettings, ...(withdrawalPolicy ? { withdrawalPolicy } : {}) },
      }));
    // Nothing saved + rows → the rows (Roth only), as before this feature.
    expect(drawn(withRows(), "acct-brokerage")).toBe(0);
    expect(drawn(withRows(policy({ method: "custom" })), "acct-brokerage")).toBe(0);
    expect(withRows(policy({ method: "order" }))).toEqual(baseline);
  });
});
