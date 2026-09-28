import { describe, it, expect } from "vitest";
import { categorizeDraw } from "../withdrawal";
import { classifyTransferTax } from "../tax-classification";
import { computeTradIraPool, iraPoolKey } from "../ira-basis";
import { applyRothConversions } from "../roth-conversions";
import { applyTransfers } from "../transfers";
import type { Account, AccountLedger, RothConversion } from "../types";

const OWNER = [{ kind: "family_member" as const, familyMemberId: "fm-client", percent: 1 }];
const INHERITED = { inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945 };
const BROKERAGE: Account = {
  id: "brk", name: "brk", category: "taxable", subType: "brokerage", titlingType: "jtwros",
  value: 0, basis: 0, growthRate: 0, rmdEnabled: false, owners: OWNER,
};

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

/** One `amount` transfer source → target in 2026, heir aged 45. Every account
 *  gets a ledger; balances and basis default to 0. */
function runTransfer(
  source: Account,
  target: Account,
  amount: number,
  balances: Record<string, number>,
  basis: Record<string, number> = {},
  others: Account[] = [],
) {
  const accounts = [source, target, ...others];
  const basisMap: Record<string, number> = Object.fromEntries(accounts.map((a) => [a.id, basis[a.id] ?? 0]));
  const accountLedgers = Object.fromEntries(accounts.map((a) => [a.id, ledger(balances[a.id] ?? 0)]));
  const r = applyTransfers({
    transfers: [{
      id: "t", name: "Move", sourceAccountId: source.id, targetAccountId: target.id,
      amount, mode: "one_time", startYear: 2026, growthRate: 0, schedules: [],
    }],
    accounts,
    accountBalances: Object.fromEntries(accounts.map((a) => [a.id, balances[a.id] ?? 0])),
    basisMap, accountLedgers,
    year: 2026, ownerAges: { client: 45 },
  });
  const targetEntry = accountLedgers[target.id].entries.find((e) => e.sourceId === "t");
  return { ...r.byTransfer.t, penalty: r.earlyWithdrawalPenalty, basisMap, targetEntryBasis: targetEntry?.basis };
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
  it("applyTransfers hands the inherited flag to the classifier", () => {
    const penaltyFrom = (source: Account) => runTransfer(source, BROKERAGE, 10_000, { [source.id]: 100_000 }).penalty;
    expect(penaltyFrom(ira("inh", "traditional_ira", INHERITED))).toBe(0);
    expect(penaltyFrom(ira("own", "traditional_ira"))).toBe(1_000);
  });
  it("Roth, transferred out to a taxable account: an inherited Roth's earnings are tax- and penalty-free", () => {
    // No contribution basis, so the whole 10,000 is earnings.
    const inh = runTransfer(ira("inh-roth", "roth_ira", INHERITED), BROKERAGE, 10_000, { "inh-roth": 100_000 });
    expect(inh.taxableOrdinaryIncome).toBe(0);
    expect(inh.penalty).toBe(0);
    // Control: the heir's own Roth pays tax and the 10% on the earnings.
    const own = runTransfer(ira("own-roth", "roth_ira"), BROKERAGE, 10_000, { "own-roth": 100_000 });
    expect(own.taxableOrdinaryIncome).toBe(10_000);
    expect(own.penalty).toBe(1_000);
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
  it("the inherited IRA's basis neither shelters nor funds the heir's own conversion", () => {
    const own = ira("own", "traditional_ira");
    const inh = ira("inh", "traditional_ira", INHERITED);
    const roth = ira("roth", "roth_ira", { value: 0 });
    const conv: RothConversion = {
      id: "rc", name: "Convert own", destinationAccountId: "roth",
      sourceAccountIds: ["own"], conversionType: "full_account",
      fixedAmount: 0, startYear: 2026, indexingRate: 0,
    };
    // The inherited IRA is all post-tax basis. Pooled with the heir's $0-basis
    // IRA it would make a third of the conversion tax-free and lose basis.
    const basisMap: Record<string, number> = { own: 0, inh: 50_000, roth: 0 };
    const r = applyRothConversions({
      conversions: [conv], accounts: [own, inh, roth],
      accountBalances: { own: 100_000, inh: 50_000, roth: 0 }, basisMap,
      accountLedgers: { own: ledger(100_000), inh: ledger(50_000), roth: ledger(0) },
      year: 2026, ownerAges: { client: 51 },
    });
    expect(r.taxableOrdinaryIncome).toBe(100_000);
    expect(basisMap.inh).toBe(50_000);
  });
});

describe("Transfers technique: an inherited IRA keeps its own tax treatment", () => {
  it("a transfer-based conversion of the heir's own IRA pro-rates against the heir's pool only", () => {
    // Heir's pool: 20,000 basis in 100,000 → 20% of a conversion is tax-free.
    // Pooling the 300,000 inherited IRA would dilute that to 5% (47,500 taxable).
    const own = ira("own", "traditional_ira");
    const inh = ira("inh", "traditional_ira", INHERITED);
    const roth = ira("roth", "roth_ira");
    const balances = { own: 100_000, inh: 300_000 };
    const basis = { own: 20_000 };
    const viaTransfer = runTransfer(own, roth, 50_000, balances, basis, [inh]);
    expect(viaTransfer.label).toBe("roth_conversion");
    expect(viaTransfer.taxableOrdinaryIncome).toBeCloseTo(40_000, 6);
    // The Roth-conversion technique agrees for the same household.
    const viaTechnique = applyRothConversions({
      conversions: [{
        id: "rc", name: "Convert 50k", destinationAccountId: "roth", sourceAccountIds: ["own"],
        conversionType: "fixed_amount", fixedAmount: 50_000, startYear: 2026, indexingRate: 0,
      }],
      accounts: [own, inh, roth],
      accountBalances: { ...balances, roth: 0 },
      basisMap: { own: 20_000, inh: 0, roth: 0 },
      accountLedgers: { own: ledger(100_000), inh: ledger(300_000), roth: ledger(0) },
      year: 2026, ownerAges: { client: 45 },
    });
    expect(viaTechnique.taxableOrdinaryIncome).toBeCloseTo(40_000, 6);
  });

  it("inherited Traditional → the heir's own Traditional IRA is a taxed distribution, not a rollover", () => {
    // Inherited IRA: 10,000 basis in 100,000 (its own pool). Heir's IRA: 50,000 basis.
    const inh = ira("inh", "traditional_ira", INHERITED);
    const own = ira("own", "traditional_ira");
    const r = runTransfer(inh, own, 20_000, { inh: 100_000, own: 200_000 }, { inh: 10_000, own: 50_000 });
    expect(r.label).toBe("taxable_distribution");
    // Net of the inherited IRA's own pro-rata basis (2,000); no penalty at 45.
    expect(r.taxableOrdinaryIncome).toBeCloseTo(18_000, 6);
    expect(r.penalty).toBe(0);
    // The basis the distribution returned leaves the source …
    expect(r.basisMap.inh).toBeCloseTo(8_000, 6);
    // … and every dollar landing in the heir's IRA is after-tax.
    expect(r.basisMap.own).toBeCloseTo(70_000, 6);
    expect(r.targetEntryBasis).toBeCloseTo(20_000, 6);
  });

  it("control: the heir's own Traditional → Traditional move stays a tax-free rollover", () => {
    const r = runTransfer(ira("own", "traditional_ira"), ira("own2", "traditional_ira"), 20_000, { own: 100_000 });
    expect(r.label).toBe("tax_free_rollover");
    expect(r.taxableOrdinaryIncome).toBe(0);
  });

  it("inherited Traditional → a Roth IRA is a distribution, never a Roth conversion", () => {
    const r = runTransfer(ira("inh", "traditional_ira", INHERITED), ira("roth", "roth_ira"), 20_000, { inh: 100_000 });
    expect(r.label).toBe("taxable_distribution");
    expect(r.taxableOrdinaryIncome).toBe(20_000);
    expect(r.penalty).toBe(0);
    expect(r.basisMap.roth).toBe(20_000);
  });

  it("inherited Roth → the heir's own Roth IRA is tax-free, and all of it becomes the target's basis", () => {
    const r = runTransfer(ira("inh-roth", "roth_ira", INHERITED), ira("roth", "roth_ira"), 20_000, { "inh-roth": 100_000 });
    expect(r.label).toBe("taxable_distribution");
    expect(r.taxableOrdinaryIncome).toBe(0);
    expect(r.penalty).toBe(0);
    expect(r.basisMap.roth).toBe(20_000);
  });

  it("inherited → inherited (trustee-to-trustee) stays a tax-free rollover", () => {
    const r = runTransfer(
      ira("inh", "traditional_ira", INHERITED), ira("inh2", "traditional_ira", INHERITED),
      20_000, { inh: 100_000 }, { inh: 10_000 },
    );
    expect(r.label).toBe("tax_free_rollover");
    expect(r.taxableOrdinaryIncome).toBe(0);
    // Today's proportional basis move.
    expect(r.basisMap.inh).toBeCloseTo(8_000, 6);
    expect(r.basisMap.inh2).toBeCloseTo(2_000, 6);
  });
});
