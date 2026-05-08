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

describe("applyAssetPurchases — deterministic synthetic ids", () => {
  it("uses technique-acct-${purchase.id} so resells can resolve later", () => {
    _resetSyntheticIdCounter();
    const purchase: AssetTransaction = {
      id: "buy-uuid-fixed",
      name: "Vacation Home",
      type: "buy",
      year: 2030,
      assetName: "Lakeside Cottage",
      assetCategory: "real_estate",
      assetSubType: "rental_property",
      purchasePrice: 400_000,
      growthRate: 0.05,
      basis: 400_000,
    };
    const accountBalances: Record<string, number> = { checking: 1_000_000 };
    const basisMap: Record<string, number> = { checking: 1_000_000 };
    const accountLedgers: Record<string, AccountLedger> = {
      checking: makeLedger(1_000_000),
    };

    const result = applyAssetPurchases({
      purchases: [purchase],
      accounts: [],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "checking",
    });

    expect(result.newAccounts).toHaveLength(1);
    expect(result.newAccounts[0].id).toBe("technique-acct-buy-uuid-fixed");
  });
});

describe("applyAssetSales — partial sales on existing accounts", () => {
  it("partial 40%: balance and basis prorate; account NOT removed", () => {
    const sell: AssetTransaction = {
      id: "partial-sell",
      name: "40% sell",
      type: "sell",
      year: 2030,
      accountId: "real-acct-1",
      fractionSold: 0.4,
      qualifiesForHomeSaleExclusion: false,
    };
    const accountBalances: Record<string, number> = { "real-acct-1": 500_000, checking: 0 };
    const basisMap: Record<string, number> = { "real-acct-1": 200_000, checking: 0 };

    const result = applyAssetSales({
      sales: [sell],
      accounts: [{ id: "real-acct-1", category: "taxable" } as Account],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers: {
        "real-acct-1": makeLedger(500_000),
        checking: makeLedger(0),
      },
      year: 2030,
      defaultCheckingId: "checking",
      filingStatus: "married_joint",
    });

    expect(result.breakdown[0].saleValue).toBeCloseTo(200_000, 2);
    expect(result.breakdown[0].basis).toBeCloseTo(80_000, 2);
    expect(result.breakdown[0].capitalGain).toBeCloseTo(120_000, 2);
    expect(accountBalances["real-acct-1"]).toBeCloseTo(300_000, 2);
    expect(basisMap["real-acct-1"]).toBeCloseTo(120_000, 2);
    expect(result.removedAccountIds).not.toContain("real-acct-1");
  });

  it("fraction=1 mirrors today's full-sale behavior", () => {
    const sell: AssetTransaction = {
      id: "full-sell",
      name: "100% sell",
      type: "sell",
      year: 2030,
      accountId: "real-acct-2",
      fractionSold: 1,
      qualifiesForHomeSaleExclusion: false,
    };
    const accountBalances: Record<string, number> = { "real-acct-2": 500_000, checking: 0 };
    const basisMap: Record<string, number> = { "real-acct-2": 200_000, checking: 0 };
    const result = applyAssetSales({
      sales: [sell],
      accounts: [{ id: "real-acct-2", category: "taxable" } as Account],
      liabilities: [],
      accountBalances, basisMap,
      accountLedgers: {
        "real-acct-2": makeLedger(500_000),
        checking: makeLedger(0),
      },
      year: 2030, defaultCheckingId: "checking", filingStatus: "married_joint",
    });
    expect(accountBalances["real-acct-2"]).toBe(0);
    expect(result.removedAccountIds).toContain("real-acct-2");
  });

  it("overrideSaleValue takes precedence over fraction-derived saleValue", () => {
    const sell: AssetTransaction = {
      id: "override-partial",
      name: "Override partial",
      type: "sell",
      year: 2030,
      accountId: "real-acct-3",
      fractionSold: 0.4,
      overrideSaleValue: 250_000,  // wins over 0.4 * 500_000 = 200_000
      qualifiesForHomeSaleExclusion: false,
    };
    const accountBalances: Record<string, number> = { "real-acct-3": 500_000, checking: 0 };
    const basisMap: Record<string, number> = { "real-acct-3": 200_000, checking: 0 };
    const result = applyAssetSales({
      sales: [sell],
      accounts: [{ id: "real-acct-3", category: "taxable" } as Account],
      liabilities: [],
      accountBalances, basisMap,
      accountLedgers: {
        "real-acct-3": makeLedger(500_000),
        checking: makeLedger(0),
      },
      year: 2030, defaultCheckingId: "checking", filingStatus: "married_joint",
    });
    expect(result.breakdown[0].saleValue).toBe(250_000);
    // basis still pro-rates to fraction (no overrideBasis)
    expect(result.breakdown[0].basis).toBeCloseTo(80_000, 2);
  });
});

describe("applyAssetSales — source resolution", () => {
  it("resolves sell.purchaseTransactionId → technique-acct-${purchase.id}", () => {
    const sell: AssetTransaction = {
      id: "sell-uuid",
      name: "Sell Vacation Home",
      type: "sell",
      year: 2035,
      purchaseTransactionId: "buy-uuid-fixed",
      qualifiesForHomeSaleExclusion: false,
    };
    const accountBalances: Record<string, number> = {
      "technique-acct-buy-uuid-fixed": 510_000,  // post-growth value
      "checking": 50_000,
    };
    const basisMap: Record<string, number> = {
      "technique-acct-buy-uuid-fixed": 400_000,
      "checking": 50_000,
    };
    const result = applyAssetSales({
      sales: [sell],
      accounts: [{
        id: "technique-acct-buy-uuid-fixed",
        category: "real_estate",
      } as Account],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers: {
        "technique-acct-buy-uuid-fixed": makeLedger(510_000),
        "checking": makeLedger(50_000),
      },
      year: 2035,
      defaultCheckingId: "checking",
      filingStatus: "married_joint",
    });

    expect(result.breakdown[0].accountId).toBe("technique-acct-buy-uuid-fixed");
    expect(result.breakdown[0].capitalGain).toBeCloseTo(110_000, 2);
    expect(result.capitalGains).toBeCloseTo(110_000, 2);
  });

  it("skips with skipped='orphaned' when sell has neither accountId nor purchaseTransactionId", () => {
    const sell: AssetTransaction = {
      id: "orphan-sell",
      name: "Orphaned",
      type: "sell",
      year: 2035,
      qualifiesForHomeSaleExclusion: false,
    };
    const result = applyAssetSales({
      sales: [sell],
      accounts: [],
      liabilities: [],
      accountBalances: { checking: 0 },
      basisMap: { checking: 0 },
      accountLedgers: { checking: makeLedger(0) },
      year: 2035,
      defaultCheckingId: "checking",
      filingStatus: "married_joint",
    });
    expect(result.capitalGains).toBe(0);
    expect(result.breakdown).toEqual([
      expect.objectContaining({
        transactionId: "orphan-sell",
        skipped: "orphaned",
      }),
    ]);
  });

  it("skips with skipped='no-source-balance' when synthetic source not yet created", () => {
    // Sell year before buy year: form should block this, defense-in-depth here.
    const sell: AssetTransaction = {
      id: "early-sell",
      name: "Early",
      type: "sell",
      year: 2025,
      purchaseTransactionId: "buy-uuid-fixed",
      qualifiesForHomeSaleExclusion: false,
    };
    const result = applyAssetSales({
      sales: [sell],
      accounts: [],
      liabilities: [],
      accountBalances: { checking: 0 },  // no technique-acct-* yet
      basisMap: { checking: 0 },
      accountLedgers: { checking: makeLedger(0) },
      year: 2025,
      defaultCheckingId: "checking",
      filingStatus: "married_joint",
    });
    expect(result.breakdown[0].skipped).toBe("no-source-balance");
  });
});

describe("applyAssetSales — partial sales on synthetic accounts", () => {
  it("partial sale on synthetic source carries residual into next year", () => {
    const sell: AssetTransaction = {
      id: "partial-synth",
      name: "Partial vacation home",
      type: "sell",
      year: 2035,
      purchaseTransactionId: "buy-uuid-fixed",
      fractionSold: 0.5,
      qualifiesForHomeSaleExclusion: false,
    };
    const accountBalances: Record<string, number> = {
      "technique-acct-buy-uuid-fixed": 510_000,
      checking: 0,
    };
    const basisMap: Record<string, number> = {
      "technique-acct-buy-uuid-fixed": 400_000,
      checking: 0,
    };
    const result = applyAssetSales({
      sales: [sell],
      accounts: [{
        id: "technique-acct-buy-uuid-fixed",
        category: "real_estate",
      } as Account],
      liabilities: [],
      accountBalances, basisMap,
      accountLedgers: {
        "technique-acct-buy-uuid-fixed": makeLedger(510_000),
        checking: makeLedger(0),
      },
      year: 2035, defaultCheckingId: "checking", filingStatus: "married_joint",
    });
    expect(result.breakdown[0].saleValue).toBeCloseTo(255_000, 2);
    expect(result.breakdown[0].basis).toBeCloseTo(200_000, 2);
    expect(result.breakdown[0].capitalGain).toBeCloseTo(55_000, 2);
    expect(accountBalances["technique-acct-buy-uuid-fixed"]).toBeCloseTo(255_000, 2);
    expect(result.removedAccountIds).not.toContain("technique-acct-buy-uuid-fixed");
  });

  it("partial sale on mortgaged real-estate does NOT pay off the mortgage", () => {
    const sell: AssetTransaction = {
      id: "partial-mortgaged",
      name: "Partial mortgaged",
      type: "sell",
      year: 2035,
      accountId: "rental-1",
      fractionSold: 0.5,
      qualifiesForHomeSaleExclusion: false,
    };
    const accountBalances: Record<string, number> = { "rental-1": 600_000, checking: 0 };
    const basisMap: Record<string, number> = { "rental-1": 400_000, checking: 0 };
    const liability = {
      id: "mortgage-1",
      name: "Mortgage",
      balance: 200_000,
      linkedPropertyId: "rental-1",
    } as Liability;
    const result = applyAssetSales({
      sales: [sell],
      accounts: [{ id: "rental-1", category: "real_estate" } as Account],
      liabilities: [liability],
      accountBalances, basisMap,
      accountLedgers: {
        "rental-1": makeLedger(600_000),
        checking: makeLedger(0),
      },
      year: 2035, defaultCheckingId: "checking", filingStatus: "married_joint",
    });
    expect(result.breakdown[0].mortgagePaidOff).toBe(0);
    expect(result.removedLiabilityIds).not.toContain("mortgage-1");
  });

  it("full sale on mortgaged real-estate pays off the mortgage (regression)", () => {
    const sell: AssetTransaction = {
      id: "full-mortgaged",
      name: "Full mortgaged",
      type: "sell",
      year: 2035,
      accountId: "rental-2",
      // fractionSold null → full sale
      qualifiesForHomeSaleExclusion: false,
    };
    const accountBalances: Record<string, number> = { "rental-2": 600_000, checking: 0 };
    const basisMap: Record<string, number> = { "rental-2": 400_000, checking: 0 };
    const liability = {
      id: "mortgage-2",
      name: "Mortgage",
      balance: 200_000,
      linkedPropertyId: "rental-2",
    } as Liability;
    const result = applyAssetSales({
      sales: [sell],
      accounts: [{ id: "rental-2", category: "real_estate" } as Account],
      liabilities: [liability],
      accountBalances, basisMap,
      accountLedgers: {
        "rental-2": makeLedger(600_000),
        checking: makeLedger(0),
      },
      year: 2035, defaultCheckingId: "checking", filingStatus: "married_joint",
    });
    expect(result.breakdown[0].mortgagePaidOff).toBe(200_000);
    expect(result.removedLiabilityIds).toContain("mortgage-2");
  });
});

describe("applyAssetSales — §121 + partial sales", () => {
  it("partial sale of a primary-residence buy uses per-sale §121 cap", () => {
    const sell: AssetTransaction = {
      id: "partial-primary",
      name: "Partial primary residence",
      type: "sell",
      year: 2035,
      accountId: "primary-1",
      fractionSold: 0.5,
      qualifiesForHomeSaleExclusion: true,
    };
    // Half-balance: sale 600_000, basis 300_000, gain 300_000.
    // Single cap = 250_000 → taxable = 50_000.
    const accountBalances: Record<string, number> = { "primary-1": 1_200_000, checking: 0 };
    const basisMap: Record<string, number> = { "primary-1": 600_000, checking: 0 };
    const result = applyAssetSales({
      sales: [sell],
      accounts: [{ id: "primary-1", category: "real_estate" } as Account],
      liabilities: [],
      accountBalances, basisMap,
      accountLedgers: {
        "primary-1": makeLedger(1_200_000),
        checking: makeLedger(0),
      },
      year: 2035, defaultCheckingId: "checking", filingStatus: "single",
    });
    expect(result.breakdown[0].capitalGain).toBeCloseTo(300_000, 2);
    expect(result.breakdown[0].homeSaleExclusionApplied).toBe(250_000);
    expect(result.breakdown[0].taxableCapitalGain).toBeCloseTo(50_000, 2);
    expect(result.capitalGains).toBeCloseTo(50_000, 2);
  });
});
