import { describe, it, expect } from "vitest";
import { categorizeDraw } from "../withdrawal";
import { applyAssetSales } from "../asset-transactions";
import type { ApplyAssetSalesInput } from "../asset-transactions";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account } from "../types";

const taxableAcct: Account = {
  id: "a1",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  titlingType: "jtwros",
  value: 100_000,
  basis: 200_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

describe("taxable withdrawal loss realization", () => {
  it("realizes a proportional loss when basis exceeds value", () => {
    // $100k value, $200k basis → drawing $10k realizes a $10k loss.
    const draw = categorizeDraw({
      account: taxableAcct, amount: 10_000, balance: 100_000,
      basisMap: { a1: 200_000 }, ownerAge: 70,
    });
    expect(draw.capitalGains).toBeCloseTo(-10_000, 2);
    expect(draw.basisReturn).toBeCloseTo(20_000, 2);
  });

  it("still reports a gain when value exceeds basis", () => {
    const draw = categorizeDraw({
      account: taxableAcct, amount: 10_000, balance: 100_000,
      basisMap: { a1: 60_000 }, ownerAge: 70,
    });
    expect(draw.capitalGains).toBeCloseTo(4_000, 2);
    expect(draw.basisReturn).toBeCloseTo(6_000, 2);
  });

  it("draws fresh basis first with no gain or loss", () => {
    const draw = categorizeDraw({
      account: taxableAcct, amount: 5_000, balance: 100_000,
      basisMap: { a1: 200_000 }, freshBasisRemaining: 5_000, ownerAge: 70,
    });
    expect(draw.capitalGains).toBe(0);
    expect(draw.basisReturn).toBe(5_000);
  });
});

function sellInput(
  category: "taxable" | "real_estate",
  qualifiesForHomeSaleExclusion: boolean,
): ApplyAssetSalesInput {
  return {
    sales: [{
      id: "s1", name: "Sell asset", type: "sell", year: 2026, accountId: "asset",
      fractionSold: 1, qualifiesForHomeSaleExclusion,
      transactionCostPct: 0, transactionCostFlat: 0,
    }],
    accounts: [
      {
        id: "asset", name: "Asset", category, subType: "brokerage",
        titlingType: "jtwros", value: 300_000, basis: 500_000,
        growthRate: 0, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "chk", name: "Checking", category: "cash", subType: "checking",
        titlingType: "jtwros", value: 0, basis: 0,
        growthRate: 0, rmdEnabled: false, isDefaultChecking: true,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ],
    liabilities: [],
    accountBalances: { asset: 300_000, chk: 0 },
    basisMap: { asset: 500_000 },   // underwater by $200k
    accountLedgers: {},
    year: 2026,
    defaultCheckingId: "chk",
    filingStatus: "married_joint",
  };
}

describe("asset-sale loss realization", () => {
  it("realizes a loss on a taxable asset sold below basis", () => {
    const r = applyAssetSales(sellInput("taxable", false));
    expect(r.breakdown[0].capitalGain).toBeCloseTo(-200_000, 2);
    expect(r.breakdown[0].taxableCapitalGain).toBeCloseTo(-200_000, 2);
    expect(r.capitalGains).toBeCloseTo(-200_000, 2);
    expect(r.disallowedLosses).toBe(0);
  });

  it("disallows the loss on a personal residence (§165(c))", () => {
    const r = applyAssetSales(sellInput("real_estate", true));
    expect(r.breakdown[0].capitalGain).toBeCloseTo(-200_000, 2);
    expect(r.breakdown[0].taxableCapitalGain).toBe(0);
    expect(r.breakdown[0].disallowedLoss).toBeCloseTo(200_000, 2);
    expect(r.capitalGains).toBe(0);
    expect(r.disallowedLosses).toBeCloseTo(200_000, 2);
  });

  it("allows the loss on investment real estate (flag off)", () => {
    const r = applyAssetSales(sellInput("real_estate", false));
    expect(r.breakdown[0].taxableCapitalGain).toBeCloseTo(-200_000, 2);
    expect(r.disallowedLosses).toBe(0);
  });

  it("still applies the §121 exclusion on a GAIN", () => {
    const input = sellInput("real_estate", true);
    input.basisMap = { asset: 100_000 };  // $200k gain
    const r = applyAssetSales(input);
    expect(r.breakdown[0].homeSaleExclusionApplied).toBeCloseTo(200_000, 2);
    expect(r.breakdown[0].taxableCapitalGain).toBe(0);
    expect(r.breakdown[0].disallowedLoss).toBe(0);
  });
});

/**
 * Task 9 §4 — the drill-down `bySource` gates. These are display-only, but a
 * `> 0` gate does not merely OMIT the loss rows, it makes the drill-down
 * CONTRADICT the total it sits under: a year netting to −$10k rendered as a
 * lone +$50k row.
 */
describe("capital-loss drill-down itemization", () => {
  const brokerage = (id: string, value: number, basis: number): Account => ({
    id,
    name: id,
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value,
    basis,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  });

  const checking: Account = {
    id: "chk",
    name: "Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: 100_000,
    basis: 100_000,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  it("itemizes BOTH sale rows and reconciles their sum to the year's net capital gains", () => {
    // +$50k on one sale, −$60k on another, same year → net −$10k.
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const y0 = runProjection({
      ...base,
      accounts: [checking, brokerage("winner", 150_000, 100_000), brokerage("loser", 40_000, 100_000)],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "tx-gain",
          name: "Sell winner",
          type: "sell",
          year: 2026,
          accountId: "winner",
          overrideSaleValue: 150_000,
          overrideBasis: 100_000,
          proceedsAccountId: "chk",
        },
        {
          id: "tx-loss",
          name: "Sell loser",
          type: "sell",
          year: 2026,
          accountId: "loser",
          overrideSaleValue: 40_000,
          overrideBasis: 100_000,
          proceedsAccountId: "chk",
        },
      ],
    })[0];

    const bySource = y0.taxDetail!.bySource;
    const gainRow = bySource["sale:tx-gain"];
    const lossRow = bySource["sale:tx-loss"];

    expect(gainRow).toBeDefined();
    expect(gainRow!.type).toBe("capital_gains");
    expect(gainRow!.amount).toBeCloseTo(50_000, 6);

    expect(lossRow, "the loss sale was dropped from the drill-down").toBeDefined();
    expect(lossRow!.type).toBe("capital_gains");
    expect(lossRow!.amount).toBeCloseTo(-60_000, 6);

    // Stated as an equality so it cannot pass vacuously: the itemization must
    // reconcile to the total it sits under.
    expect(y0.taxDetail!.capitalGains).toBeCloseTo(-10_000, 6);
    expect(gainRow!.amount + lossRow!.amount).toBeCloseTo(y0.taxDetail!.capitalGains, 6);
  });
});
