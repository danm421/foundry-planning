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
  // Ledger 54: the real-estate variants used to carry subType "brokerage",
  // so the fixture did not mean what its test names claimed. §165(c) now keys
  // off the subType, which makes it load-bearing rather than decorative.
  subType: string = category === "real_estate" ? "primary_residence" : "brokerage",
): ApplyAssetSalesInput {
  return {
    sales: [{
      id: "s1", name: "Sell asset", type: "sell", year: 2026, accountId: "asset",
      fractionSold: 1, qualifiesForHomeSaleExclusion,
      transactionCostPct: 0, transactionCostFlat: 0,
    }],
    accounts: [
      {
        id: "asset", name: "Asset", category, subType,
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

  /**
   * i2 — §165(c) used to fail OPEN. The disallowance keyed off
   * `sale.qualifiesForHomeSaleExclusion`, whose checkbox is labelled
   * "Qualifies for home-sale GAIN exclusion (§121)" and defaults UNCHECKED. An
   * advisor modelling a vacation home sold below basis has no reason to tick a
   * box about excluding gain, so the loss was booked as fully deductible and
   * fed a $3,000/yr deduction plus carryforward for decades. The default is now
   * inverted: real estate is personal-use unless the account says otherwise.
   */
  it("disallows the loss on a vacation home even with the §121 box UNCHECKED", () => {
    const r = applyAssetSales(sellInput("real_estate", false, "other"));
    expect(r.breakdown[0].capitalGain).toBeCloseTo(-200_000, 2);
    expect(r.breakdown[0].taxableCapitalGain).toBe(0);
    expect(r.breakdown[0].disallowedLoss).toBeCloseTo(200_000, 2);
    expect(r.capitalGains).toBe(0);
  });

  it("allows the loss on real estate explicitly held as a rental", () => {
    const r = applyAssetSales(sellInput("real_estate", false, "rental_property"));
    expect(r.breakdown[0].taxableCapitalGain).toBeCloseTo(-200_000, 2);
    expect(r.disallowedLosses).toBe(0);
  });

  it("allows the loss on commercial real estate", () => {
    const r = applyAssetSales(sellInput("real_estate", false, "commercial_property"));
    expect(r.breakdown[0].taxableCapitalGain).toBeCloseTo(-200_000, 2);
    expect(r.disallowedLosses).toBe(0);
  });

  it("still applies the §121 exclusion on a GAIN", () => {
    const input = sellInput("real_estate", true);
    // Ledger 54: keep the account's own `basis` in step with the basisMap
    // override, or the fixture claims a $200k gain while the account still
    // says it is $200k underwater.
    input.basisMap = { asset: 100_000 };  // $200k gain
    input.accounts[0].basis = 100_000;
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

  /**
   * i3 — the `sale:` row itemized the RAW `item.capitalGain` while the total it
   * sits under sums the post-§121 / post-§165(c) `taxableCapitalGain`. A
   * residence sold $200k below basis emitted a −$200,000 row under a $0 total:
   * the exact itemization-contradicts-its-total defect Task 9 existed to
   * remove, in a NEW instance created by Task 6's own §165(c) work.
   */
  const residence = (id: string, value: number, basis: number): Account => ({
    id,
    name: id,
    category: "real_estate",
    subType: "primary_residence",
    titlingType: "jtwros",
    value,
    basis,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  });

  function runResidenceSale(value: number, basis: number, qualifies: boolean) {
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    return runProjection({
      ...base,
      accounts: [checking, residence("home", value, basis)],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      assetTransactions: [
        {
          id: "tx-home",
          name: "Sell home",
          type: "sell",
          year: 2026,
          accountId: "home",
          overrideSaleValue: value,
          overrideBasis: basis,
          proceedsAccountId: "chk",
          qualifiesForHomeSaleExclusion: qualifies,
        },
      ],
    })[0];
  }

  it("itemizes the §165(c)-disallowed residence loss as 0, matching its total", () => {
    const y0 = runResidenceSale(300_000, 500_000, false);
    expect(y0.taxDetail!.capitalGains).toBeCloseTo(0, 6);
    const row = y0.taxDetail!.bySource["sale:tx-home"];
    // Either omitted (the `!== 0` gate) or present at 0 — never −200,000 under
    // a $0 total.
    expect(row?.amount ?? 0).toBeCloseTo(0, 6);
  });

  it("itemizes a §121-excluded residence GAIN as 0, matching its total", () => {
    const y0 = runResidenceSale(500_000, 300_000, true);
    expect(y0.taxDetail!.capitalGains).toBeCloseTo(0, 6);
    const row = y0.taxDetail!.bySource["sale:tx-home"];
    expect(row?.amount ?? 0).toBeCloseTo(0, 6);
  });
});

/**
 * The §165(c) / trust-take-back SEAM.
 *
 * The household ADD books the POST-§165(c) figure: `applyAssetSales` accumulates
 * `totalCapitalGains += taxableCapitalGain`, which is 0 for a disallowed
 * personal-use loss. Both trust take-backs must therefore subtract that SAME
 * post-§165(c) figure. Subtracting the raw signed `item.capitalGain` instead
 * subtracts a negative that was never added, and the household is billed for a
 * PHANTOM gain it never realized — a trust-owned home at $1M against a $5M basis
 * produced `taxDetail.capitalGains === +4,000,000`.
 *
 * Before i2 the two sides happened to agree (real-estate losses were allowed, so
 * `taxableCapitalGain === capitalGain` and raw-vs-taxable was unobservable).
 * i2 made them diverge, which is what turned a latent asymmetry into a live bug.
 *
 * There are TWO independent subtraction sites and a plan reaches only one of
 * them, so both are exercised:
 *   - the non-grantor-trust take-back (`assetTransactionGains`), reachable only
 *     when `nonGrantorTrusts.length > 0`;
 *   - the §664(c) CRT net-out (`crtSaleGainByTxn`), which runs at the ADD and is
 *     the ONLY site a CRT-only plan reaches (a CRT is excluded from the 1041
 *     pass, so the block holding the other site is dead).
 */
describe("trust-owned §165(c) loss does not create a phantom household gain", () => {
  const TRUST_ID = "00000000-0000-0000-0000-0000000000f1";

  /**
   * @param trustSubType "crt" routes through the §664(c) net-out; undefined
   *        leaves an ordinary irrevocable non-grantor trust, which is the only
   *        way to make the 1041 take-back site execute at all.
   */
  function runTrustResidenceSale(trustSubType?: "crt") {
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    return runProjection({
      ...base,
      accounts: [
        {
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
        } as Account,
        {
          id: "trust-chk",
          name: "Trust Checking",
          category: "cash",
          subType: "checking",
          value: 100_000,
          basis: 100_000,
          growthRate: 0,
          rmdEnabled: false,
          isDefaultChecking: true,
          owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
        } as Account,
        {
          id: "trust-home",
          name: "Trust Residence",
          category: "real_estate",
          subType: "primary_residence",
          value: 1_000_000,
          basis: 5_000_000,
          growthRate: 0,
          rmdEnabled: false,
          owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
        } as Account,
      ],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      entities: [
        {
          id: TRUST_ID,
          name: "Test Trust",
          entityType: "trust",
          isIrrevocable: true,
          isGrantor: false,
          includeInPortfolio: false,
          grantor: "client",
          ...(trustSubType ? { trustSubType } : {}),
        },
      ] as NonNullable<Parameters<typeof runProjection>[0]["entities"]>,
      assetTransactions: [
        {
          id: "tx-trust-home",
          name: "Sell trust residence",
          type: "sell",
          year: 2026,
          accountId: "trust-home",
          overrideSaleValue: 1_000_000,
          overrideBasis: 5_000_000,
          proceedsAccountId: "trust-chk",
        },
      ] as NonNullable<Parameters<typeof runProjection>[0]["assetTransactions"]>,
    })[0];
  }

  for (const [label, subType] of [
    ["ordinary non-grantor trust", undefined],
    ["CRT (§664(c) net-out)", "crt"],
  ] as const) {
    describe(label, () => {
      it("leaves household capital gains at 0 rather than booking a phantom +$4M", () => {
        const y0 = runTrustResidenceSale(subType);

        // The §165(c) disallowance is the precondition. Asserting it FIRST stops
        // the capital-gains assertion below from passing vacuously — if the sale
        // never ran (orphaned account, no source balance) the gain would be 0
        // for entirely the wrong reason.
        expect(
          y0.taxDetail!.disallowedCapitalLoss ?? 0,
          "the trust's residence sale never reached the §165(c) branch — the rest of this test is vacuous",
        ).toBeCloseTo(4_000_000, 6);

        expect(
          y0.taxDetail!.capitalGains,
          "the trust's DISALLOWED loss was subtracted from the household 1040 as if it had been added, inventing a gain",
        ).toBeCloseTo(0, 6);
      });

      it("itemizes the exempt trust sale at 0, with the drill-down reconciled to the total", () => {
        const y0 = runTrustResidenceSale(subType);

        // Both assertions are needed — the two sites fail DIFFERENTLY, and
        // either one alone is green on one of the paths:
        //
        //  - non-grantor: the `sale:` row is built from `taxableCapitalGain`
        //    (0, so gated out) while the total came from the raw figure — a
        //    $4,000,000 cell over an EMPTY itemization. Reconciliation catches
        //    it; the per-row assertion does not.
        //  - CRT: the row subtracts the same raw `crtSaleGainByTxn` entry the
        //    total did, so it emits a phantom +$4,000,000 row that reconciles
        //    PERFECTLY to a wrong total. Only the per-row assertion catches it.
        expect(
          y0.taxDetail!.bySource["sale:tx-trust-home"]?.amount ?? 0,
          "the exempt trust's disallowed loss is itemized on the household 1040 as a gain",
        ).toBeCloseTo(0, 6);

        const itemized = Object.values(y0.taxDetail!.bySource)
          .filter((r) => r.type === "capital_gains")
          .reduce((sum, r) => sum + r.amount, 0);

        expect(
          itemized,
          "the capital-gains drill-down contradicts the total it sits under",
        ).toBeCloseTo(y0.taxDetail!.capitalGains, 6);
      });
    });
  }
});
