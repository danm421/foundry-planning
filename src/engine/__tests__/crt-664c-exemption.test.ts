import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildCrtLifecycleFixture, CRT_FIXTURE_IDS } from "./_fixtures/crt";

describe("CRT realizationCorpus fixture", () => {
  it("defaults leave the fixture untouched (no taxable account, no taxYearRows)", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
    });
    expect(
      data.accounts.find((a) => a.id === CRT_FIXTURE_IDS.CRT_TAXABLE_ID),
    ).toBeUndefined();
    expect(data.taxYearRows).toBeUndefined();
    expect(
      data.entities!.find((e) => e.id === CRT_FIXTURE_IDS.CRT_ENTITY_ID)!.isGrantor,
    ).toBe(true);
  });

  it("realizationCorpus adds a CRT-owned taxable account that actually grows, and seeds bracket-mode tax params", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      realizationCorpus: true,
    });

    const taxable = data.accounts.find(
      (a) => a.id === CRT_FIXTURE_IDS.CRT_TAXABLE_ID,
    )!;
    expect(taxable).toBeDefined();
    expect(taxable.realization?.pctOrdinaryIncome).toBe(1);
    expect(taxable.owners[0]).toMatchObject({
      kind: "entity",
      entityId: CRT_FIXTURE_IDS.CRT_ENTITY_ID,
    });
    // Bracket mode must be live — without taxYearRows the engine silently falls
    // back to flat-0 and NO tax is computed, which would make the §664(c)
    // assertions in this file pass for the wrong reason.
    expect(data.taxYearRows?.length).toBeGreaterThan(0);

    // The account generates real internal income: 5% × $1M = $50k/yr ordinary.
    const years = runProjection(data);
    const y1 = years.find((y) => y.year === 2026)!;
    expect(y1.accountLedgers[CRT_FIXTURE_IDS.CRT_TAXABLE_ID].growth).toBeCloseTo(
      50_000,
      0,
    );
  });

  it("isGrantor opt overrides the entity flag", () => {
    const data = buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      isGrantor: false,
    });
    expect(
      data.entities!.find((e) => e.id === CRT_FIXTURE_IDS.CRT_ENTITY_ID)!.isGrantor,
    ).toBe(false);
  });
});

/**
 * IRC §664(c)(1): a CRT is exempt from income tax. Internal income accumulates
 * untaxed; only the annuity/unitrust PAYMENT is taxed to the recipient.
 *
 * The guard suite for audit F1. What it actually proves, stated honestly —
 * the previous version of this docblock claimed it caught "any of the seven tax
 * forks being missed", which was false, and that false confidence is what let a
 * missed fork ship and turn the exemption into a household-1040 leak:
 *
 *   - `isTaxExemptTrust` has TEN call sites. EIGHT are individually
 *     mutation-killed by this file: replace any one of them with `false` and
 *     this file goes red. That was verified by running it, not by inspection.
 *   - TWO are NOT covered, and cannot be: the growth pass's grantorTrustIncome
 *     and non-grantor-push guards are behaviorally INERT in isolation
 *     (disabling either alone yields byte-identical projection output), because
 *     collect-trust-income drops realizations for any entity that
 *     buildNonGrantorTrusts already excluded. They are only reachable once the
 *     buildNonGrantorTrusts guard is ALSO gone — that pair IS caught here.
 *
 * Two things this file depends on, both easy to destroy by accident:
 *   1. `realizationCorpus` / `crtGapFill` seed `taxYearRows`. Without them the
 *      engine falls back to flat-0 and computes NO tax, so every "the CRT pays
 *      nothing" assertion passes for the wrong reason. A green here means
 *      nothing unless bracket mode is live.
 *   2. Assertions are on TAX, not on payment/deduction amounts —
 *      `realizationCorpus` adds an account without updating the splitInterest
 *      snapshot, so the corpus is deliberately larger than `inceptionValue`.
 */
describe("CRT §664(c) exemption", () => {
  const build = (isGrantor: boolean) =>
    buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      realizationCorpus: true,
      isGrantor,
    });

  it("grantor-flagged CRT: internal realization income never reaches the household 1040", () => {
    const years = runProjection(build(true));
    const y1 = years.find((y) => y.year === 2026)!;
    const sources = y1.taxDetail?.bySource ?? {};

    const leaked = Object.keys(sources).filter((k) =>
      k.startsWith(`${CRT_FIXTURE_IDS.CRT_TAXABLE_ID}:`),
    );
    expect(
      leaked,
      `CRT internal income leaked onto the household 1040: ${leaked.join(", ")}`,
    ).toEqual([]);
  });

  it("default (non-grantor) CRT: never enters the compressed-bracket 1041 pass", () => {
    const years = runProjection(build(false));
    for (const y of years) {
      const breakdown = y.trustTaxByEntity?.get(CRT_FIXTURE_IDS.CRT_ENTITY_ID);
      expect(
        breakdown?.total ?? 0,
        `CRT was taxed $${breakdown?.total} in the 1041 pass in ${y.year}`,
      ).toBe(0);
    }
  });

  it("the annuity/unitrust payment IS still taxed as ordinary income (Spec A simplification retained)", () => {
    const years = runProjection(build(true));
    const y1 = years.find((y) => y.year === 2026)!;
    const entry =
      y1.taxDetail?.bySource?.[
        `crt_distribution:${CRT_FIXTURE_IDS.CRT_ENTITY_ID}`
      ];
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("ordinary_income");
    expect(entry!.amount).toBeGreaterThan(0);
  });
});

/**
 * Witnesses for the §664(c) guards on the CRT's non-realization income
 * surfaces: an entity-owned income row and an entity-owned RMD.
 *
 * The base fixture has `incomes: []` and no retirement account, so those forks
 * never execute and their guards are invisible to mutation. `crtIncomeRow` and
 * `crtIra` are what make them reachable.
 *
 * These all use the GRANTOR config deliberately: each guard sits in front of an
 * `effectiveIsGrantor` fork whose else-branch already skips the row, so with
 * isGrantor=false the guard is a no-op and removing it changes nothing.
 */
describe("CRT §664(c) exemption — internal income surfaces", () => {
  const buildFull = (isGrantor: boolean) =>
    buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      realizationCorpus: true,
      crtIncomeRow: true,
      crtIra: true,
      isGrantor,
    });

  it("grantor-flagged CRT: the unitrust payment is the ONLY thing on the household 1040", () => {
    const years = runProjection(buildFull(true));
    const y1 = years.find((y) => y.year === 2026)!;
    const bySource = y1.taxDetail?.bySource ?? {};
    const payment = `crt_distribution:${CRT_FIXTURE_IDS.CRT_ENTITY_ID}`;

    // §664(c) leaves exactly one taxable item: the payment to the recipient.
    // Anything else here is CRT internal income that leaked through a fork —
    // the income row, the IRA's RMD, or the brokerage's realization.
    expect(
      Object.keys(bySource).sort(),
      "CRT internal income leaked onto the household 1040",
    ).toEqual([payment]);
    expect(y1.taxDetail?.ordinaryIncome).toBe(bySource[payment]!.amount);
  });

  it("grantor-flagged CRT: CRT-owned income rows stay off the household income statement", () => {
    const years = runProjection(buildFull(true));
    const y1 = years.find((y) => y.year === 2026)!;
    // Distinct surface from taxDetail: grantorIncome merges into the year's
    // income display separately from the 1040 tax buckets.
    expect(
      y1.income?.bySource?.[CRT_FIXTURE_IDS.CRT_INCOME_ID],
      "the CRT's income row was reported as household income",
    ).toBeUndefined();
    expect(y1.income?.total ?? 0).toBe(0);
  });

  /**
   * The CRT's expenses drive its checking negative, so step-12c liquidates its
   * zero-basis stock to refill — realizing a gain that is DEFERRED to the next
   * year's carry-in drain. That drain is a tax fork of its own, and the
   * gap-fill is its only producer (a sale goes through `saleResult` instead).
   */
  it("grantor-flagged CRT: a prior-year gap-fill liquidation gain never drains onto the household 1040", () => {
    const years = runProjection(
      buildCrtLifecycleFixture({
        inceptionYear: 2026,
        payoutPercent: 0.06,
        termYears: 5,
        inceptionValue: 1_000_000,
        crtGapFill: true,
        isGrantor: true,
      }),
    );
    // The liquidation happens in 2026; the realized gain drains the year after.
    const drainYear = years.find((y) => y.year === 2027)!;
    expect(
      drainYear.taxDetail?.bySource?.["entity_gap_fill_prior_year:capital_gains"],
      "the CRT's deferred liquidation gain drained onto the household 1040",
    ).toBeUndefined();
    expect(drainYear.taxDetail?.capitalGains ?? 0).toBe(0);
  });

  it("non-grantor CRT: never even ENTERS the 1041 pass (not merely taxed at zero)", () => {
    const years = runProjection(buildFull(false));
    for (const y of years) {
      // Asserting `.total === 0` is NOT enough: the pass emits a zero
      // breakdown for a trust it admits but finds no income for, so a
      // bottom-line assertion cannot tell "excluded" from "included but
      // starved". Admission itself is the observable.
      expect(
        y.trustTaxByEntity?.has(CRT_FIXTURE_IDS.CRT_ENTITY_ID) ?? false,
        `CRT was admitted to the 1041 pass in ${y.year}`,
      ).toBe(false);
    }
  });
});

/**
 * The canonical CRT structure: contribute low-basis stock, sell it INSIDE the
 * trust free of tax under §664(c), diversify the proceeds. Both isGrantor
 * configs must land at zero — §664(c) exempts the trust either way.
 *
 * The household ADD of `saleResult.capitalGains` is unconditional, and the only
 * thing that backs trust-owned gains out is the subtraction inside
 * `if (nonGrantorTrusts.length > 0)`. A CRT-only plan makes that block dead, so
 * excluding the CRT from the 1041 pass without also excluding its gain from the
 * household ADD moves the gain onto the 1040 instead of exempting it.
 */
describe("CRT §664(c) exemption — sale of appreciated corpus", () => {
  const buildSale = (isGrantor: boolean) =>
    buildCrtLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      realizationCorpus: true,
      crtSale: true,
      isGrantor,
    });

  for (const isGrantor of [false, true]) {
    const label = isGrantor ? "grantor-flagged" : "default (non-grantor)";

    it(`${label} CRT: the sale gain never reaches the household 1040`, () => {
      const years = runProjection(buildSale(isGrantor));
      const saleYear = years.find((y) => y.year === 2027)!;

      expect(
        saleYear.taxDetail?.capitalGains ?? 0,
        "the CRT's sale gain was taxed as household capital gains",
      ).toBe(0);
      expect(
        saleYear.taxDetail?.bySource?.[
          `sale:${CRT_FIXTURE_IDS.CRT_SALE_TXN_ID}`
        ],
        "the CRT's sale gain is itemized on the household 1040 drill-down",
      ).toBeUndefined();
    });

    it(`${label} CRT: the sale gain never reaches the 1041 pass either`, () => {
      const years = runProjection(buildSale(isGrantor));
      for (const y of years) {
        expect(
          y.trustTaxByEntity?.get(CRT_FIXTURE_IDS.CRT_ENTITY_ID)?.total ?? 0,
          `CRT was taxed in the 1041 pass in ${y.year}`,
        ).toBe(0);
      }
    });
  }

  /**
   * A CRT alongside an ORDINARY non-grantor trust. The sibling is what makes
   * the `nonGrantorTrusts.length > 0` block execute at all — the exempt gain
   * must not be handed to that pass, or it gets subtracted from a household
   * total it was never added to and silently erases tax on the household's own
   * $500k gain.
   */
  it("a CRT next to an ordinary non-grantor trust does not erase tax on the household's OWN gain", () => {
    const years = runProjection(
      buildCrtLifecycleFixture({
        inceptionYear: 2026,
        payoutPercent: 0.06,
        termYears: 5,
        inceptionValue: 1_000_000,
        realizationCorpus: true,
        crtSale: true,
        siblingNonGrantorTrust: true,
        isGrantor: false,
      }),
    );
    const saleYear = years.find((y) => y.year === 2027)!;

    expect(
      saleYear.taxDetail?.capitalGains ?? 0,
      "the household's own $500k gain must survive the CRT exemption intact",
    ).toBe(500_000);
    expect(
      saleYear.taxDetail?.bySource?.[
        `sale:${CRT_FIXTURE_IDS.HOUSEHOLD_SALE_TXN_ID}`
      ]?.amount,
    ).toBe(500_000);
    expect(
      saleYear.taxDetail?.bySource?.[`sale:${CRT_FIXTURE_IDS.CRT_SALE_TXN_ID}`],
      "the CRT's exempt gain is itemized on the household 1040",
    ).toBeUndefined();
  });
});
