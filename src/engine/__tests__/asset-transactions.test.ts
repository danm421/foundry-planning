import { describe, it, expect, beforeEach } from "vitest";
import { applyAssetSales, applyAssetPurchases, _resetSyntheticIdCounter } from "../asset-transactions";
import type { Account, Liability, AssetTransaction, AccountLedger } from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

function makeLedger(value: number): AccountLedger {
  return {
    beginningValue: value,
    growth: 0,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    endingValue: value,
    entries: [],
  };
}

const rentalProperty: Account = {
  id: "rental-1",
  name: "Rental Property",
  category: "real_estate",
  subType: "rental_property",
  value: 500000,
  basis: 300000,
  growthRate: 0.03,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const mortgage: Liability = {
  id: "mort-1",
  name: "Rental Mortgage",
  balance: 200000,
  interestRate: 0.065,
  monthlyPayment: 2000,
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  linkedPropertyId: "rental-1",
  isInterestDeductible: true,
  extraPayments: [],
  owners: [],
};

const checkingAccount: Account = {
  id: "checking-1",
  name: "Checking",
  category: "cash",
  subType: "checking",
  value: 50000,
  basis: 50000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const brokerageAccount: Account = {
  id: "brokerage-1",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 200000,
  basis: 150000,
  growthRate: 0.07,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

beforeEach(() => {
  _resetSyntheticIdCounter();
});

describe("applyAssetSales", () => {
  it("sells an asset and calculates capital gains", () => {
    const sale: AssetTransaction = {
      id: "sale-1", name: "Sell Brokerage", type: "sell", year: 2028, accountId: "brokerage-1",
    };
    const balances: Record<string, number> = { "brokerage-1": 200000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "brokerage-1": 150000, "checking-1": 50000 };
    const ledgers: Record<string, AccountLedger> = { "brokerage-1": makeLedger(200000), "checking-1": makeLedger(50000) };

    const result = applyAssetSales({
      sales: [sale], accounts: [brokerageAccount, checkingAccount], liabilities: [],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1", filingStatus: "single",
    });

    expect(result.capitalGains).toBe(50000);
    expect(balances["brokerage-1"]).toBe(0);
    expect(balances["checking-1"]).toBe(250000);
    expect(result.removedAccountIds).toContain("brokerage-1");
  });

  it("uses override sale value and basis", () => {
    const sale: AssetTransaction = {
      id: "sale-1", name: "Sell Brokerage", type: "sell", year: 2028,
      accountId: "brokerage-1", overrideSaleValue: 250000, overrideBasis: 100000,
    };
    const balances: Record<string, number> = { "brokerage-1": 200000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "brokerage-1": 150000, "checking-1": 50000 };
    const ledgers: Record<string, AccountLedger> = { "brokerage-1": makeLedger(200000), "checking-1": makeLedger(50000) };

    const result = applyAssetSales({
      sales: [sale], accounts: [brokerageAccount, checkingAccount], liabilities: [],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1", filingStatus: "single",
    });

    expect(result.capitalGains).toBe(150000);
    expect(balances["checking-1"]).toBe(300000);
  });

  it("deducts transaction costs from proceeds", () => {
    const sale: AssetTransaction = {
      id: "sale-1", name: "Sell Property", type: "sell", year: 2028,
      accountId: "rental-1", transactionCostPct: 0.06, transactionCostFlat: 5000,
    };
    const balances: Record<string, number> = { "rental-1": 500000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "rental-1": 300000, "checking-1": 50000 };
    const ledgers: Record<string, AccountLedger> = { "rental-1": makeLedger(500000), "checking-1": makeLedger(50000) };

    const result = applyAssetSales({
      sales: [sale], accounts: [rentalProperty, checkingAccount], liabilities: [],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1", filingStatus: "single",
    });

    expect(result.capitalGains).toBe(200000);
    // Proceeds = 500k - 30k (6%) - 5k flat = 465k
    expect(balances["checking-1"]).toBe(515000);
  });

  it("pays off linked mortgage on real estate sale", () => {
    const sale: AssetTransaction = {
      id: "sale-1", name: "Sell Rental", type: "sell", year: 2028, accountId: "rental-1",
    };
    const balances: Record<string, number> = { "rental-1": 500000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "rental-1": 300000, "checking-1": 50000 };
    const ledgers: Record<string, AccountLedger> = { "rental-1": makeLedger(500000), "checking-1": makeLedger(50000) };

    const result = applyAssetSales({
      sales: [sale], accounts: [rentalProperty, checkingAccount], liabilities: [mortgage],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1", filingStatus: "single",
    });

    expect(balances["checking-1"]).toBe(350000); // 50k + (500k - 200k mortgage)
    expect(result.removedLiabilityIds).toContain("mort-1");
    expect(result.capitalGains).toBe(200000);
  });

  it("routes proceeds to specified account", () => {
    const sale: AssetTransaction = {
      id: "sale-2", name: "Sell Rental to Brokerage", type: "sell", year: 2028,
      accountId: "rental-1", proceedsAccountId: "brokerage-1",
    };
    const balances: Record<string, number> = { "rental-1": 500000, "brokerage-1": 200000, "checking-1": 50000 };
    const basisMap: Record<string, number> = { "rental-1": 300000, "brokerage-1": 150000, "checking-1": 50000 };
    const ledgers: Record<string, AccountLedger> = {
      "rental-1": makeLedger(500000), "brokerage-1": makeLedger(200000), "checking-1": makeLedger(50000),
    };

    applyAssetSales({
      sales: [sale], accounts: [rentalProperty, brokerageAccount, checkingAccount], liabilities: [],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1", filingStatus: "single",
    });

    expect(balances["brokerage-1"]).toBe(700000);
    expect(balances["checking-1"]).toBe(50000);
  });
});

describe("applyAssetSales — home-sale exclusion (§121)", () => {
  const homeAccount: Account = {
    id: "home-1",
    name: "Primary Residence",
    category: "real_estate",
    subType: "primary_residence",
    value: 900000,
    basis: 300000,
    growthRate: 0.03,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  function runSale(
    overrideSaleValue: number,
    overrideBasis: number,
    filingStatus: "single" | "married_joint" | "head_of_household" | "married_separate",
    opts: { qualifies?: boolean; account?: Account } = {}
  ) {
    const account = opts.account ?? homeAccount;
    const sale: AssetTransaction = {
      id: "sale-home",
      name: "Sell Home",
      type: "sell",
      year: 2028,
      accountId: account.id,
      overrideSaleValue,
      overrideBasis,
      qualifiesForHomeSaleExclusion: opts.qualifies ?? false,
    };
    const balances: Record<string, number> = { [account.id]: overrideSaleValue, "checking-1": 0 };
    const basisMap: Record<string, number> = { [account.id]: overrideBasis, "checking-1": 0 };
    const ledgers: Record<string, AccountLedger> = {
      [account.id]: makeLedger(overrideSaleValue),
      "checking-1": makeLedger(0),
    };
    return applyAssetSales({
      sales: [sale],
      accounts: [account, checkingAccount],
      liabilities: [],
      accountBalances: balances,
      basisMap,
      accountLedgers: ledgers,
      year: 2028,
      defaultCheckingId: "checking-1",
      filingStatus,
    });
  }

  it("applies $250k single-filer cap fully absorbing a sub-cap gain", () => {
    const result = runSale(500_000, 300_000, "single", { qualifies: true });
    expect(result.capitalGains).toBe(0);
    expect(result.homeSaleExclusionTotal).toBe(200_000);
    expect(result.breakdown[0].capitalGain).toBe(200_000);
    expect(result.breakdown[0].homeSaleExclusionApplied).toBe(200_000);
    expect(result.breakdown[0].taxableCapitalGain).toBe(0);
  });

  it("caps exclusion at $250k for single filer on a larger gain", () => {
    const result = runSale(700_000, 300_000, "single", { qualifies: true });
    expect(result.capitalGains).toBe(150_000);
    expect(result.homeSaleExclusionTotal).toBe(250_000);
    expect(result.breakdown[0].taxableCapitalGain).toBe(150_000);
  });

  it("caps exclusion at $250k for head-of-household", () => {
    const result = runSale(700_000, 300_000, "head_of_household", { qualifies: true });
    expect(result.capitalGains).toBe(150_000);
    expect(result.homeSaleExclusionTotal).toBe(250_000);
  });

  it("caps exclusion at $250k for married-filing-separately", () => {
    const result = runSale(700_000, 300_000, "married_separate", { qualifies: true });
    expect(result.capitalGains).toBe(150_000);
    expect(result.homeSaleExclusionTotal).toBe(250_000);
  });

  it("applies $500k married-joint cap on a $600k gain", () => {
    const result = runSale(900_000, 300_000, "married_joint", { qualifies: true });
    expect(result.capitalGains).toBe(100_000);
    expect(result.homeSaleExclusionTotal).toBe(500_000);
  });

  it("applies no exclusion when the flag is false", () => {
    const result = runSale(700_000, 300_000, "married_joint", { qualifies: false });
    expect(result.capitalGains).toBe(400_000);
    expect(result.homeSaleExclusionTotal).toBe(0);
    expect(result.breakdown[0].homeSaleExclusionApplied).toBe(0);
  });

  it("ignores the flag on a non-real-estate account (engine safety net)", () => {
    const result = runSale(500_000, 300_000, "single", {
      qualifies: true,
      account: brokerageAccount,
    });
    expect(result.capitalGains).toBe(200_000);
    expect(result.homeSaleExclusionTotal).toBe(0);
  });

  it("applies no exclusion on a zero-gain sale", () => {
    const result = runSale(300_000, 300_000, "single", { qualifies: true });
    expect(result.capitalGains).toBe(0);
    expect(result.homeSaleExclusionTotal).toBe(0);
    expect(result.breakdown[0].homeSaleExclusionApplied).toBe(0);
  });

  it("applies no exclusion on a loss sale (gain floored at 0)", () => {
    const result = runSale(250_000, 300_000, "single", { qualifies: true });
    expect(result.capitalGains).toBe(0);
    expect(result.homeSaleExclusionTotal).toBe(0);
    expect(result.breakdown[0].capitalGain).toBe(0);
  });
});

describe("applyAssetPurchases", () => {
  it("creates a new asset funded from a specific account", () => {
    const buy: AssetTransaction = {
      id: "buy-1", name: "Buy Rental", type: "buy", year: 2028,
      assetName: "New Rental Property", assetCategory: "real_estate", assetSubType: "rental_property",
      purchasePrice: 400000, growthRate: 0.03, fundingAccountId: "checking-1",
    };
    const balances: Record<string, number> = { "checking-1": 500000 };
    const basisMap: Record<string, number> = { "checking-1": 500000 };
    const ledgers: Record<string, AccountLedger> = { "checking-1": makeLedger(500000) };

    const result = applyAssetPurchases({
      purchases: [buy], accounts: [checkingAccount], liabilities: [],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1",
    });

    expect(balances["checking-1"]).toBe(100000);
    expect(result.newAccounts).toHaveLength(1);
    expect(result.newAccounts[0].name).toBe("New Rental Property");
    expect(result.newAccounts[0].value).toBe(400000);
    expect(result.newAccounts[0].basis).toBe(400000);
    expect(result.newAccounts[0].category).toBe("real_estate");
  });

  it("creates a new asset with mortgage (only equity portion debited)", () => {
    const buy: AssetTransaction = {
      id: "buy-1", name: "Buy Rental with Mortgage", type: "buy", year: 2028,
      assetName: "New Rental", assetCategory: "real_estate", assetSubType: "rental_property",
      purchasePrice: 500000, growthRate: 0.03, fundingAccountId: "checking-1",
      mortgageAmount: 400000, mortgageRate: 0.065, mortgageTermMonths: 360,
    };
    const balances: Record<string, number> = { "checking-1": 200000 };
    const basisMap: Record<string, number> = { "checking-1": 200000 };
    const ledgers: Record<string, AccountLedger> = { "checking-1": makeLedger(200000) };

    const result = applyAssetPurchases({
      purchases: [buy], accounts: [checkingAccount], liabilities: [],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1",
    });

    expect(balances["checking-1"]).toBe(100000); // 200k - 100k equity
    expect(result.newAccounts).toHaveLength(1);
    expect(result.newAccounts[0].value).toBe(500000);
    expect(result.newLiabilities).toHaveLength(1);
    expect(result.newLiabilities[0].balance).toBe(400000);
    expect(result.newLiabilities[0].interestRate).toBe(0.065);
    expect(result.newLiabilities[0].linkedPropertyId).toBe(result.newAccounts[0].id);
  });

  it("uses default checking when no funding account specified", () => {
    const buy: AssetTransaction = {
      id: "buy-1", name: "Buy Business", type: "buy", year: 2028,
      assetName: "New LLC", assetCategory: "business", assetSubType: "llc",
      purchasePrice: 100000, growthRate: 0.05,
    };
    const balances: Record<string, number> = { "checking-1": 150000 };
    const basisMap: Record<string, number> = { "checking-1": 150000 };
    const ledgers: Record<string, AccountLedger> = { "checking-1": makeLedger(150000) };

    applyAssetPurchases({
      purchases: [buy], accounts: [checkingAccount], liabilities: [],
      accountBalances: balances, basisMap, accountLedgers: ledgers, year: 2028, defaultCheckingId: "checking-1",
    });

    expect(balances["checking-1"]).toBe(50000);
  });
});
