import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData } from "./fixtures";
import type { AssetTransaction, Account, Liability } from "../types";

/**
 * Repro for Finding #1: NaN propagates through cashflow after sell→buy→buy→sell
 * sequence with linked mortgage. Mirrors Dan Sample's 2027–2030 pattern.
 */
describe("NaN propagation — sell→buy→buy→sell with linked mortgage", () => {
  it("does not produce NaN in ledger / tax / expense fields", () => {
    const home: Account = {
      id: "home-orig",
      name: "Original Home",
      category: "real_estate",
      subType: "primary_residence",
      owner: "joint",
      value: 750_000,
      basis: 500_000,
      growthRate: 0.04,
      rmdEnabled: false,
      annualPropertyTax: 12_000,
      propertyTaxGrowthRate: 0.03,
    };
    const homeMortgage: Liability = {
      id: "liab-home-orig",
      name: "Home Mortgage",
      balance: 300_000,
      interestRate: 0.065,
      monthlyPayment: 2_500,
      startYear: 2020,
      startMonth: 1,
      termMonths: 360,
      linkedPropertyId: "home-orig",
      isInterestDeductible: true,
      extraPayments: [],
    };

    const sellOrig: AssetTransaction = {
      id: "tx-sell-orig",
      name: "Sell Original Home",
      type: "sell",
      year: 2027,
      accountId: "home-orig",
      qualifiesForHomeSaleExclusion: true,
    };
    const buy1: AssetTransaction = {
      id: "tx-buy-1",
      name: "Buy Second Home",
      type: "buy",
      year: 2028,
      assetName: "Second Home",
      assetCategory: "real_estate",
      assetSubType: "primary_residence",
      purchasePrice: 600_000,
      growthRate: 0.04,
      mortgageAmount: 400_000,
      mortgageRate: 0.07,
      mortgageTermMonths: 360,
    };
    const buy2: AssetTransaction = {
      id: "tx-buy-2",
      name: "Buy Third Home",
      type: "buy",
      year: 2029,
      assetName: "Third Home",
      assetCategory: "real_estate",
      assetSubType: "primary_residence",
      purchasePrice: 800_000,
      growthRate: 0.04,
      mortgageAmount: 500_000,
      mortgageRate: 0.07,
      mortgageTermMonths: 360,
    };
    // Sell the 2028 purchase in 2030 (Dan's pattern)
    // We can't name the sell target by id before it exists — engine uses
    // technique-acct-<n> synthetic ids. So instead sell by name via a
    // post-hoc lookup is not supported; mirror the real flow: sell something
    // that exists at year 2030.  The engine creates ids like technique-acct-N.
    // For repro we'll sell "home-orig" replaced later; but since home-orig is
    // gone by 2030, we'll craft a sell referencing one of the synthetic ids.
    // applyAssetSales only fires if accountId matches, so we need to know it.
    // The synthetic counter resets per projection; 2028 buy → technique-acct-1,
    // 2029 buy → technique-acct-2 (approximate).
    const sellSynth: AssetTransaction = {
      id: "tx-sell-synth",
      name: "Sell Second Home",
      type: "sell",
      year: 2030,
      accountId: "technique-acct-1",
      qualifiesForHomeSaleExclusion: true,
    };

    const data = buildClientData({
      accounts: [
        home,
        {
          id: "acct-checking",
          name: "Checking",
          category: "cash",
          subType: "checking",
          owner: "joint",
          value: 200_000,
          basis: 200_000,
          growthRate: 0.02,
          rmdEnabled: false,
          isDefaultChecking: true,
        },
      ],
      liabilities: [homeMortgage],
      assetTransactions: [sellOrig, buy1, buy2, sellSynth],
      withdrawalStrategy: [],
      savingsRules: [],
    });

    const result = runProjection(data);

    // Scan every year, every ledger, for NaN.
    const nanHits: string[] = [];
    for (const row of result) {
      for (const [id, led] of Object.entries(row.accountLedgers)) {
        for (const [k, v] of Object.entries(led)) {
          if (typeof v === "number" && !Number.isFinite(v)) {
            nanHits.push(`${row.year} ${id}.${k}=${v}`);
          }
        }
      }
      if (!Number.isFinite(row.expenses.total)) nanHits.push(`${row.year} expenses.total=${row.expenses.total}`);
      if (!Number.isFinite(row.income.total)) nanHits.push(`${row.year} income.total=${row.income.total}`);
    }
    if (nanHits.length > 0) console.error("NaN hits:\n" + nanHits.slice(0, 40).join("\n"));
    expect(nanHits).toEqual([]);
  });
});
