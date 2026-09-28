import { describe, it, expect } from "vitest";
import { categorizeDraw } from "../withdrawal";
import { classifyTransferTax } from "../tax-classification";
import { computeTradIraPool, iraPoolKey } from "../ira-basis";
import { applyRothConversions } from "../roth-conversions";
import type { Account, AccountLedger, RothConversion } from "../types";

const OWNER = [{ kind: "family_member" as const, familyMemberId: "fm-client", percent: 1 }];
const INHERITED = { inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945 };

function ira(id: string, subType: string, extra: Partial<Account> = {}): Account {
  return {
    id, name: id, category: "retirement", subType, titlingType: "jtwros",
    value: 100_000, basis: 0, growthRate: 0, rmdEnabled: false, owners: OWNER, ...extra,
  };
}

function ledger(v: number): AccountLedger {
  return {
    beginningValue: v, growth: 0, contributions: 0, distributions: 0,
    internalContributions: 0, internalDistributions: 0,
    rmdAmount: 0, fees: 0, endingValue: v, entries: [],
  };
}

describe("early-withdrawal penalty does not apply to an inherited IRA (§72(t)(2)(A)(ii))", () => {
  it("Traditional: a pre-59½ draw is ordinary income with no penalty", () => {
    const draw = categorizeDraw({ account: ira("inh", "traditional_ira", INHERITED), amount: 10_000, balance: 100_000, basisMap: {}, ownerAge: 45 });
    expect(draw.ordinaryIncome).toBe(10_000);
    expect(draw.earlyWithdrawalPenalty).toBe(0);
  });
  it("control: the same draw from the heir's own IRA is penalized", () => {
    const draw = categorizeDraw({ account: ira("own", "traditional_ira"), amount: 10_000, balance: 100_000, basisMap: {}, ownerAge: 45 });
    expect(draw.earlyWithdrawalPenalty).toBe(1_000);
  });
  it("Roth: a pre-59½ draw is fully tax-free", () => {
    const draw = categorizeDraw({ account: ira("inh-roth", "roth_ira", INHERITED), amount: 10_000, balance: 100_000, basisMap: {}, ownerAge: 45 });
    expect(draw.ordinaryIncome).toBe(0);
    expect(draw.earlyWithdrawalPenalty).toBe(0);
  });
  it("transfer out to a taxable account: no penalty when the source is inherited", () => {
    const input = {
      sourceCategory: "retirement" as const, sourceSubType: "traditional_ira",
      targetCategory: "taxable" as const, targetSubType: "brokerage",
      amount: 10_000, sourceAccountValue: 100_000, sourceAccountBasis: 0,
      allTraditionalIraBasis: 0, allTraditionalIraBalance: 100_000,
      ownerAge: 45, rothBasis: 0,
    };
    expect(classifyTransferTax({ ...input, sourceIsInherited: true }).earlyWithdrawalPenalty).toBe(0);
    expect(classifyTransferTax(input).earlyWithdrawalPenalty).toBe(1_000);
  });
});

describe("an inherited Traditional IRA is its own Form 8606 pool", () => {
  it("keys the pool by the account, not the heir", () => {
    expect(iraPoolKey(ira("inh", "traditional_ira", INHERITED))).toBe("inherited:inh");
    expect(iraPoolKey(ira("own", "traditional_ira"))).toBe("fm-client");
  });
  it("keeps inherited balance and basis out of the heir's own pool", () => {
    const accounts = [ira("own", "traditional_ira"), ira("inh", "traditional_ira", INHERITED)];
    const balances = { own: 100_000, inh: 50_000 };
    const basis = { own: 20_000, inh: 10_000 };
    expect(computeTradIraPool(accounts, balances, basis, "fm-client")).toEqual({ balance: 100_000, basis: 20_000 });
    expect(computeTradIraPool(accounts, balances, basis, "inherited:inh")).toEqual({ balance: 50_000, basis: 10_000 });
  });
});

describe("an inherited IRA is never a Roth-conversion source", () => {
  it("full_account conversion drains only the heir's own IRA", () => {
    const own = ira("own", "traditional_ira");
    const inh = ira("inh", "traditional_ira", INHERITED);
    const roth = ira("roth", "roth_ira", { value: 0 });
    const conv: RothConversion = {
      id: "rc", name: "Convert all", destinationAccountId: "roth",
      sourceAccountIds: ["inh", "own"], conversionType: "full_account",
      fixedAmount: 0, startYear: 2026, indexingRate: 0,
    };
    const accountBalances: Record<string, number> = { own: 100_000, inh: 50_000, roth: 0 };
    const r = applyRothConversions({
      conversions: [conv], accounts: [own, inh, roth], accountBalances,
      basisMap: { own: 0, inh: 0, roth: 0 },
      accountLedgers: { own: ledger(100_000), inh: ledger(50_000), roth: ledger(0) },
      year: 2026, ownerAges: { client: 51 },
    });
    expect(r.taxableOrdinaryIncome).toBe(100_000);
    expect(accountBalances.inh).toBe(50_000);
    expect(accountBalances.own).toBe(0);
  });
});
