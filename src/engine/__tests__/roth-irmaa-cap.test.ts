/**
 * Roth conversion IRMAA cap — the three rules of `resolveIrmaaCeiling`.
 *
 * These run in BRACKET tax mode on purpose. `projection.medicare.test.ts` is
 * the obvious template but it runs in FLAT mode, where the phase-12 tax probe
 * short-circuits and hands back a taxable-income proxy instead of a real AGI.
 * `resolveIrmaaCeiling` deliberately returns null on that path, so a cap test
 * written on a flat-mode fixture would pass for the wrong reason forever.
 *
 * Per the project's inline-helper convention, the scenario builders are local
 * to this file and build only the shape these tests need.
 *
 * Two describe blocks: the first pins WHICH ceiling gets resolved (premium
 * year, filing status, and the two guards that make the cap inert), the second
 * pins that the ceiling actually BINDS the conversion.
 *
 * ⚠️ The enrollment gate and flat tax mode are NEGATIVE CONTROLS: each asserts
 * the cap does NOT bind. They exit `resolveIrmaaCeiling` at different guards
 * and neither substitutes for the other — a red in either means the inertness
 * guarantee is gone, not that a fixture drifted.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  FamilyMember,
  Income,
  MedicareCoverage,
  RothConversion,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";

// ── IRMAA tier tables ───────────────────────────────────────────────────────
// Copied verbatim from `projection.medicare.test.ts` (CMS 2025, sourced from
// `data/medicare-irmaa-2024-2026.json`) so the ceilings below sit on real
// bracket boundaries. TAX_YEAR_2026 carries no Medicare fields at all, so the
// fixture spreads it and adds the four the cap needs.

const IRMAA_TIERS_SINGLE_2025 = [
  { tier: 1, magiLowerBound: 106000, magiUpperBound: 133000, partBSurcharge: 888.0,  partDSurcharge: 164.4 },
  { tier: 2, magiLowerBound: 133000, magiUpperBound: 167000, partBSurcharge: 2220.0, partDSurcharge: 425.4 },
  { tier: 3, magiLowerBound: 167000, magiUpperBound: 200000, partBSurcharge: 3552.0, partDSurcharge: 686.4 },
  { tier: 4, magiLowerBound: 200000, magiUpperBound: 500000, partBSurcharge: 4884.0, partDSurcharge: 947.4 },
  { tier: 5, magiLowerBound: 500000, magiUpperBound: null,   partBSurcharge: 5326.8, partDSurcharge: 1034.4 },
];

const IRMAA_TIERS_MFJ_2025 = [
  { tier: 1, magiLowerBound: 212000, magiUpperBound: 266000, partBSurcharge: 888.0,  partDSurcharge: 164.4 },
  { tier: 2, magiLowerBound: 266000, magiUpperBound: 334000, partBSurcharge: 2220.0, partDSurcharge: 425.4 },
  { tier: 3, magiLowerBound: 334000, magiUpperBound: 400000, partBSurcharge: 3552.0, partDSurcharge: 686.4 },
  { tier: 4, magiLowerBound: 400000, magiUpperBound: 750000, partBSurcharge: 4884.0, partDSurcharge: 947.4 },
  { tier: 5, magiLowerBound: 750000, magiUpperBound: null,   partBSurcharge: 5326.8, partDSurcharge: 1034.4 },
];

const TAX_YEAR_2026_WITH_MEDICARE: TaxYearParameters = {
  ...TAX_YEAR_2026,
  standardPartBPremium: 2220.0,
  partDNationalBase: 441.36,
  irmaaBracketsMfj: IRMAA_TIERS_MFJ_2025,
  irmaaBracketsSingle: IRMAA_TIERS_SINGLE_2025,
};

// ── Hand-computed ceilings ──────────────────────────────────────────────────
//
// The conversion year is 2026, so the PREMIUM year is 2028. The only seeded
// tax-year row is 2026, so `taxResolver.getYear(2028).sourceYear === 2026` and
// the Medicare inflation factor is (1 + 0.03) ^ (2028 - 2026) = 1.03^2 = 1.0609.
//
// `irmaaCapCeiling(tiers, 0)` returns `tiers[0].magiLowerBound` — the floor of
// tier 1, i.e. the highest surcharge-free MAGI.
//
//   MFJ    : 212_000 * 1.0609 = 224_910.80
//   SINGLE : 106_000 * 1.0609 = 112_455.40
//
// Deliberately literal. Recomputing these with `inflateIrmaaTiers` would make
// the assertion tautological — it would agree with the engine even if the
// engine aimed at the wrong year.
const MEDICARE_INFLATION_RATE = 0.03;
const CEILING_2028_MFJ = 224_910.8;
const CEILING_2028_SINGLE = 112_455.4;
/** What aiming at the CONVERSION year's table instead would give: 2026 is an
 *  exact-match row, so the factor is 1.0 and the ceiling is the raw 212_000.
 *  ~6% / ~$12.9K of headroom silently lost. */
const WRONG_CEILING_CONVERSION_YEAR_MFJ = 212_000;
/** `irmaaCapCeiling(tiers, 2)` returns tier 2's UPPER bound — the top of the
 *  band the advisor is willing to pay for.  334_000 * 1.0609 = 354_340.60. */
const CEILING_2028_MFJ_TIER2 = 354_340.6;
/** Tier 4's upper bound — the last band before the top tier, used by the
 *  "set but does not bind" test as a deliberately roomy live ceiling.
 *  750_000 * 1.0609 = 795_675. */
const CEILING_2028_MFJ_TIER4 = 795_675;
/** Top of the 2026 MFJ 24% bracket less `fillUpBracketCeiling`'s $1 backoff.
 *  2026 is the seeded row, so no tax inflation applies to it. */
const BRACKET_24_CEILING_2026_MFJ = 383_899;

function coverage(owner: "client" | "spouse"): MedicareCoverage {
  return {
    owner,
    enrollmentYear: null, // → engine enrolls the year the owner turns 65
    coverageType: "original",
    medigapMonthlyAt65: 170,
    partDPlanMonthlyAt65: 46,
    priorYearMagi: 60_000, // cold-start lookback, well below tier 1
  };
}

interface ScenarioInput {
  clientDob: string;
  spouseDob?: string;
  filingStatus: "single" | "married_joint";
  /** Only set when the scenario needs a death event. */
  lifeExpectancy?: number;
  spouseLifeExpectancy?: number;
  medicareCoverage: MedicareCoverage[];
  conversion: RothConversion;
  checkingValue: number;
  /** Defaults to "bracket". Only the flat-mode negative control overrides it. */
  taxEngineMode?: "bracket" | "flat";
  /** Income rows. Only the "already past the ceiling" test sets any — every
   *  other scenario relies on the conversion being the household's ONLY
   *  taxable income. */
  incomes?: Income[];
  /** After-tax (Form 8606) basis on the source traditional IRA. Defaults to 0
   *  so gross === taxable and the MAGI assertions read directly. */
  iraBasis?: number;
}

/** A retired household whose ONLY taxable income is the Roth conversion, so
 *  the year's AGI (== MAGI here — no fixture holds tax-exempt interest) is a
 *  direct read on what the conversion was sized to. */
function scenario(input: ScenarioInput): ClientData {
  const hasSpouse = input.spouseDob != null;
  return {
    client: {
      firstName: "Cap",
      lastName: "Test",
      dateOfBirth: input.clientDob,
      spouseDob: input.spouseDob,
      filingStatus: input.filingStatus,
      retirementAge: 65,
      planEndAge: 95,
      spouseRetirementAge: 65,
      lifeExpectancy: input.lifeExpectancy,
      spouseLifeExpectancy: input.spouseLifeExpectancy,
    },
    accounts: [
      {
        id: "acc-checking",
        name: "Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: input.checkingValue,
        basis: input.checkingValue,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
      {
        // ⚠️ LOAD-BEARING PLAN WINDOW. `rmdEnabled` is true on $3M, so "the only
        // taxable income is the conversion" holds ONLY because no scenario in
        // this file reaches RMD age inside the 2026-2030 plan window: the 1958
        // client turns 73 (their RMD age) in 2031, one year past `planEndYear`,
        // and the 1968 client's RMD age is 75. Move a DOB earlier or extend
        // `planEndYear` and RMD income appears silently — every MAGI assertion
        // below would then be measuring something else.
        id: "acc-ira",
        name: "Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 3_000_000,
        basis: input.iraBasis ?? 0,
        growthRate: 0,
        rmdEnabled: true,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
      {
        id: "acc-roth",
        name: "Roth IRA",
        category: "retirement",
        subType: "roth_ira",
        titlingType: "jtwros",
        value: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
    ],
    incomes: input.incomes ?? [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [
      { accountId: "acc-checking", priorityOrder: 1, startYear: 2026, endYear: 2030 },
    ],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2030,
      taxEngineMode: input.taxEngineMode ?? "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [],
    rothConversions: [input.conversion],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Cap",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: input.clientDob,
      } as FamilyMember,
      ...(hasSpouse
        ? [
            {
              id: SPOUSE_FM_ID,
              firstName: "Partner",
              lastName: "Test",
              relationship: "other",
              role: "spouse",
              dateOfBirth: input.spouseDob,
            } as FamilyMember,
          ]
        : []),
    ],
    externalBeneficiaries: [],
    medicareCoverage: input.medicareCoverage,
    medicarePremiumInflationEnabled: true,
    medicarePremiumInflationRate: MEDICARE_INFLATION_RATE,
    taxYearRows: [TAX_YEAR_2026_WITH_MEDICARE],
  } as ClientData;
}

function cappedFixedAmount(amount: number, capTier: number | null): RothConversion {
  return {
    id: "rc-cap",
    name: "Capped conversion",
    destinationAccountId: "acc-roth",
    sourceAccountIds: ["acc-ira"],
    conversionType: "fixed_amount",
    fixedAmount: amount,
    irmaaCapTier: capTier,
    startYear: 2026,
    endYear: 2026,
    indexingRate: 0,
  };
}

/** A bracket fill that ALSO carries a cap — the two-ceiling case. */
function cappedFillUpBracket(targetRate: number, capTier: number | null): RothConversion {
  return {
    id: "rc-cap",
    name: "Capped bracket fill",
    destinationAccountId: "acc-roth",
    sourceAccountIds: ["acc-ira"],
    conversionType: "fill_up_bracket",
    fillUpBracket: targetRate,
    // Required by the type and ignored by this strategy — the amount is solved,
    // not stated. Spelled out rather than cast away so a future required field
    // shows up as a type error here.
    fixedAmount: 0,
    irmaaCapTier: capTier,
    startYear: 2026,
    endYear: 2026,
    indexingRate: 0,
  };
}

/** A pension big enough to blow past a tier ceiling on its own. */
function pension(annualAmount: number): Income {
  return {
    id: "inc-pension",
    type: "deferred",
    name: "Pension",
    annualAmount,
    startYear: 2026,
    endYear: 2030,
    growthRate: 0,
    owner: "client",
    taxType: "ordinary_income",
  };
}

describe("Roth conversion IRMAA cap — ceiling resolution", () => {
  it("aims at the PREMIUM year's thresholds, not the conversion year's", () => {
    // MFJ, both spouses already 65+, so somebody is enrolled in premium year
    // 2028. A tier-0 cap on a $600K fixed conversion: the cap is the only thing
    // that can bind (the source IRA holds $3M).
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01", // 68 in 2026, 70 in the 2028 premium year
        spouseDob: "1959-01-01", // 67 in 2026, 69 in 2028
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, 0),
        checkingValue: 500_000,
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    expect(y2026!.taxResult, "2026 should have a bracket-mode tax result").toBeDefined();

    // No fixture account produces tax-exempt interest, so MAGI === AGI here.
    const magi = y2026!.taxResult!.flow.adjustedGrossIncome;

    expect(
      Math.abs(magi - CEILING_2028_MFJ),
      `2026 MAGI ${magi} should land on the 2028 MFJ tier-0 ceiling ${CEILING_2028_MFJ}`,
    ).toBeLessThan(50);
    // And specifically NOT on the conversion year's un-inflated table.
    expect(
      Math.abs(magi - WRONG_CEILING_CONVERSION_YEAR_MFJ),
      `2026 MAGI ${magi} must not sit on the CONVERSION year's ceiling ${WRONG_CEILING_CONVERSION_YEAR_MFJ}`,
    ).toBeGreaterThan(1_000);
  });

  it("does not bind when nobody is enrolled in the premium year", () => {
    // Negative control. Client is 58 in 2026 — 60 in premium year 2028, five
    // years short of enrollment. There is no surcharge to protect, so the
    // tier-0 cap must be inert and the full $800K must convert.
    const years = runProjection(
      scenario({
        clientDob: "1968-01-01", // 58 in 2026
        filingStatus: "single",
        medicareCoverage: [coverage("client")],
        conversion: cappedFixedAmount(800_000, 0),
        checkingValue: 1_000_000,
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    const conv = (y2026!.rothConversions ?? [])[0];
    expect(conv, "2026 should have a roth conversion").toBeDefined();

    // $800K blows past every single-filer tier (tier 4 tops out at $500K).
    expect(conv!.gross, "the full fixed amount converts when nobody is enrolled").toBeCloseTo(
      800_000,
      0,
    );
  });

  it("an INERT cap is byte-identical to no cap, basis and all", () => {
    // The gross amount alone is a weak read on inertness: the two paths that
    // can produce it (phase 5b vs the phase-12 joint solve) book DIFFERENT
    // taxable income when the source IRA holds after-tax basis — the joint
    // solve's target is a GROSS figure, so booking it as taxable would
    // over-state the tax bill. An inert cap must never reach that path, so run
    // the same household twice and compare every reported number.
    const run = (capTier: number | null) => {
      const years = runProjection(
        scenario({
          clientDob: "1968-01-01", // 58 in 2026 — 60 in premium year 2028
          filingStatus: "single",
          medicareCoverage: [coverage("client")],
          conversion: cappedFixedAmount(800_000, capTier),
          checkingValue: 1_000_000,
          iraBasis: 600_000, // 20% of the $3M pool comes back tax-free
        }),
      );
      const y = years.find((yr) => yr.year === 2026)!;
      const conv = (y.rothConversions ?? [])[0]!;
      return {
        gross: conv.gross,
        taxable: conv.taxable,
        agi: y.taxResult!.flow.adjustedGrossIncome,
        incomeTaxBase: y.taxResult!.flow.incomeTaxBase,
        taxes: y.expenses.taxes,
      };
    };

    const inertCap = run(0);
    const noCap = run(null);

    expect(inertCap.taxable, "basis must still shield 20% of the gross").toBeLessThan(
      inertCap.gross,
    );
    expect(inertCap, "an inert cap must change nothing at all").toEqual(noCap);
  });

  it("does not bind in flat tax mode", () => {
    // Second negative control — guards `resolveIrmaaCeiling`'s
    // `!useBracket || !resolved` early return.
    //
    // ⚠️ NOT redundant with the enrollment-gate test above: that one exits at a
    // different guard, and neither covers the other. Do not delete this as a
    // duplicate. In flat mode the phase-12 tax probe short-circuits and hands
    // back a taxable-income proxy as its `magi` — NOT AGI + tax-exempt interest.
    // A ceiling sized against that number yields a wrong conversion amount with
    // no error and no visible symptom, so the cap must go inert instead.
    //
    // Same household as the two-year-shift test (both spouses enrolled in
    // premium year 2028, tier-0 cap, $600K fixed). The ONLY difference is the
    // tax engine, so a red here means the guard is gone, not that the fixture
    // drifted.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, 0),
        checkingValue: 500_000,
        taxEngineMode: "flat",
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    const conv = (y2026!.rothConversions ?? [])[0];
    expect(conv, "2026 should have a roth conversion").toBeDefined();

    expect(conv!.gross, "the full fixed amount converts in flat tax mode").toBeCloseTo(
      600_000,
      0,
    );
  });

  it("uses single thresholds when the first death precedes the premium year", () => {
    // MFJ in 2026, but the spouse dies in 2027 (born 1958, life expectancy 69),
    // so the survivor files SINGLE in premium year 2028 and the thresholds
    // roughly halve. The 2026 conversion must aim at the single ceiling.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01", // 68 in 2026, 70 in 2028 — enrolled
        spouseDob: "1958-01-01",
        filingStatus: "married_joint",
        lifeExpectancy: 95, // client dies 2053, outside the plan
        spouseLifeExpectancy: 69, // spouse dies 1958 + 69 = 2027
        medicareCoverage: [coverage("client")],
        conversion: cappedFixedAmount(600_000, 0),
        checkingValue: 500_000,
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    expect(y2026!.taxResult, "2026 should have a bracket-mode tax result").toBeDefined();

    const magi = y2026!.taxResult!.flow.adjustedGrossIncome;

    expect(
      Math.abs(magi - CEILING_2028_SINGLE),
      `2026 MAGI ${magi} should land on the 2028 SINGLE tier-0 ceiling ${CEILING_2028_SINGLE}`,
    ).toBeLessThan(50);
    // The joint ceiling is roughly double — a survivor must not be handed it.
    expect(
      magi,
      `2026 MAGI ${magi} must stay well below the MFJ ceiling ${CEILING_2028_MFJ}`,
    ).toBeLessThan(150_000);
  });
});

describe("Roth conversion IRMAA cap — the ceiling binds", () => {
  it("caps a fixed_amount conversion at the tier ceiling", () => {
    // A tier-2 cap: the advisor accepts the tier-2 surcharge but no more, so
    // the ceiling is tier 2's UPPER bound. The $600K ask is far above it and
    // the $3M source pool is far below binding, so the cap is the only thing
    // that can size this conversion.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, 2),
        checkingValue: 500_000,
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    const conv = (y2026!.rothConversions ?? [])[0];
    expect(conv, "2026 should have a roth conversion").toBeDefined();

    expect(
      conv!.gross,
      `gross ${conv!.gross} must be cut back from the $600K ask`,
    ).toBeLessThan(600_000);
    // The IRA holds no after-tax basis here, so gross === taxable === MAGI.
    expect(
      Math.abs(conv!.gross - CEILING_2028_MFJ_TIER2),
      `gross ${conv!.gross} should land on the 2028 MFJ tier-2 ceiling ${CEILING_2028_MFJ_TIER2}`,
    ).toBeLessThan(50);
    expect(y2026!.taxResult!.flow.adjustedGrossIncome).toBeLessThanOrEqual(
      CEILING_2028_MFJ_TIER2 + 1,
    );
  });

  it("converts $0 when MAGI is already past the ceiling", () => {
    // A $300K pension alone clears the 2028 MFJ tier-0 ceiling ($224,910.80),
    // so no conversion of any size keeps the household surcharge-free. The
    // right answer is to convert nothing.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, 0),
        checkingValue: 500_000,
        incomes: [pension(300_000)],
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();

    const gross = (y2026!.rothConversions ?? []).reduce((s, c) => s + c.gross, 0);
    expect(gross, "nothing should convert once the ceiling is already breached").toBe(0);

    // $0 is the SOLVED answer, not a failure to solve: the joint loop must
    // treat this conversion as converged rather than burning all five
    // iterations and warning the advisor about a residual it cannot close.
    const warnings = y2026!.trustWarnings ?? [];
    expect(
      warnings.filter((w) => w.code === "engine_iteration_limit"),
      "a fully-blocked conversion is converged, not an iteration-limit failure",
    ).toHaveLength(0);
  });

  it("POSITIVE CONTROL: the same scenario with no cap converts in full", () => {
    // Guards the test above. `gross === 0` would ALSO pass if the conversion
    // silently never reached the apply path at all — a plausible regression
    // once conversions are routed between two different apply sites. Identical
    // household and identical $300K pension; the ONLY difference is the tier,
    // so a red here means the conversion vanished, not that the cap worked.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, null),
        checkingValue: 500_000,
        incomes: [pension(300_000)],
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    const conv = (y2026!.rothConversions ?? [])[0];
    expect(conv, "2026 should have a roth conversion").toBeDefined();
    expect(conv!.gross, "an uncapped conversion ignores the pension entirely").toBeCloseTo(
      600_000,
      0,
    );
  });

  it("takes the SMALLER of the bracket ceiling and the IRMAA ceiling", () => {
    // One conversion, two ceilings: fill the 24% bracket AND stay in tier 0.
    // The tier-0 MAGI ceiling ($224,910.80) is far below what filling the 24%
    // bracket would need, so IRMAA is the binding constraint.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFillUpBracket(0.24, 0),
        checkingValue: 500_000,
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    expect(y2026!.taxResult, "2026 should have a bracket-mode tax result").toBeDefined();

    const magi = y2026!.taxResult!.flow.adjustedGrossIncome;
    expect(
      Math.abs(magi - CEILING_2028_MFJ),
      `2026 MAGI ${magi} should stop at the tier-0 ceiling ${CEILING_2028_MFJ}, not the 24% bracket top`,
    ).toBeLessThan(50);

    // And the bracket is left visibly unfilled — proof the smaller ceiling won
    // rather than the two happening to agree.
    const incomeTaxBase = y2026!.taxResult!.flow.incomeTaxBase;
    expect(
      incomeTaxBase,
      `incomeTaxBase ${incomeTaxBase} should sit well below the 24% top ${BRACKET_24_CEILING_2026_MFJ}`,
    ).toBeLessThan(BRACKET_24_CEILING_2026_MFJ - 100_000);
  });

  it("never breaches the ceiling when the source IRA holds after-tax basis", () => {
    // $600K of Form 8606 basis in a $3M IRA → 20% of every conversion dollar
    // comes back tax-free. The solve runs in TAXABLE dollars but is applied as
    // a GROSS amount, so the realized income lands UNDER the ceiling. That is
    // the conservative direction: the guardrail may leave room unused, but it
    // must never let MAGI through.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, 0),
        checkingValue: 500_000,
        iraBasis: 600_000,
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();
    const conv = (y2026!.rothConversions ?? [])[0];
    expect(conv, "2026 should have a roth conversion").toBeDefined();

    // A real conversion happened — this test must not pass by converting $0.
    expect(conv!.gross, "a meaningful conversion should still run").toBeGreaterThan(100_000);
    // Basis shielded part of it, which is what makes this case different.
    expect(
      conv!.taxable,
      `taxable ${conv!.taxable} should be below gross ${conv!.gross} once basis is pro-rated`,
    ).toBeLessThan(conv!.gross);

    expect(
      conv!.taxable,
      `realized taxable ${conv!.taxable} must not breach the ceiling ${CEILING_2028_MFJ}`,
    ).toBeLessThanOrEqual(CEILING_2028_MFJ);

    // The tax line must be computed on what was REALIZED, not on the gross
    // target. Booking the target would over-state the household's income by the
    // shielded basis — a real, advisor-visible tax figure that never happened.
    const magi = y2026!.taxResult!.flow.adjustedGrossIncome;
    expect(
      magi,
      `MAGI ${magi} should equal the realized taxable ${conv!.taxable}, not the gross ${conv!.gross}`,
    ).toBeCloseTo(conv!.taxable, 0);
    expect(magi, "and it must still sit under the ceiling").toBeLessThanOrEqual(
      CEILING_2028_MFJ + 1,
    );
  });

  it("does NOT become a target for a bracket fill whose rate matches no tier", () => {
    // A `fillUpBracket` of 0.99 matches no tier — a stale value, or one the
    // "tax rates rise" stressor orphaned. It converts nothing today, and adding
    // a cap must not change that: with no bracket ceiling the cap would become
    // the ONLY ceiling and the conversion would fill straight to the tier-0
    // boundary (~$225K). That is the cap acting as a target, which is the
    // opposite of a guardrail.
    //
    // ⚠️ The old guard read this case off a NULL ceiling, which the top (37%)
    // tier also returns — so it could not tell "no such bracket" from "the
    // bracket with no top". `isTopBracketTarget` identifies the top positively.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFillUpBracket(0.99, 0),
        checkingValue: 500_000,
      }),
    );

    const y2026 = years.find((y) => y.year === 2026);
    expect(y2026, "year 2026 should exist").toBeDefined();

    const gross = (y2026!.rothConversions ?? []).reduce((s, c) => s + c.gross, 0);
    expect(gross, "an unrecognized bracket target converts nothing, cap or no cap").toBe(0);
    // Specifically not the tier-0 ceiling, which is what filling TO the cap
    // would produce.
    const magi = y2026!.taxResult!.flow.adjustedGrossIncome;
    expect(
      magi,
      `MAGI ${magi} must not have been filled up to the tier-0 ceiling ${CEILING_2028_MFJ}`,
    ).toBeLessThan(1_000);
  });
});

describe("Roth conversion IRMAA cap — the outcome record", () => {
  it("reports limitedBy: irmaa when the cap binds", () => {
    // Same household as "caps a fixed_amount conversion at the tier ceiling":
    // a $600K ask, a $3M pool, and a tier-0 cap that is the only thing small
    // enough to bind. The gross assertion there proves the SIZE; this proves
    // the year can say WHY, which is what an advisor sees on the drill row.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, 0),
        checkingValue: 500_000,
      }),
    );

    const conv = (years.find((y) => y.year === 2026)!.rothConversions ?? [])[0];
    expect(conv, "2026 should have a roth conversion").toBeDefined();

    expect(conv!.limitedBy, "the cap is the constraint that bound").toBe("irmaa");
    expect(conv!.irmaaCapTier, "and it names the tier it aimed at").toBe(0);
    // `requested` is the untouched instruction, so the pair reads as
    // "asked for $600K, converted $224K".
    expect(conv!.requested, "the $600K ask is recorded verbatim").toBeCloseTo(600_000, 0);
    expect(
      conv!.gross,
      `gross ${conv!.gross} must be below the requested ${conv!.requested}`,
    ).toBeLessThan(conv!.requested);
  });

  it("reports limitedBy: null when the cap is SET but does not bind", () => {
    // ⚠️ The cap here is LIVE, not absent. Testing an ABSENT cap would prove
    // nothing: that path never reaches the sizer, so `null` would be the
    // trivially right answer for the wrong reason. Both spouses are enrolled in
    // premium year 2028, so the tier-4 ceiling resolves and this conversion
    // routes through the phase-12 joint solve exactly like the binding case.
    // It just asks for less than the ceiling allows.
    const run = (ask: number) => {
      const years = runProjection(
        scenario({
          clientDob: "1958-01-01",
          spouseDob: "1959-01-01",
          filingStatus: "married_joint",
          medicareCoverage: [coverage("client"), coverage("spouse")],
          conversion: cappedFixedAmount(ask, 4),
          checkingValue: 500_000,
        }),
      );
      const conv = (years.find((y) => y.year === 2026)!.rothConversions ?? [])[0];
      expect(conv, "2026 should have a roth conversion").toBeDefined();
      return conv!;
    };

    // CONTROL, and the whole point of the test: the SAME household with the
    // SAME tier-4 cap, asking for more than the ceiling allows. If this comes
    // back unlimited then the cap was silently inert and the assertion below
    // would be measuring nothing.
    const bound = run(900_000);
    expect(bound.limitedBy, "the tier-4 ceiling really is live for this household").toBe(
      "irmaa",
    );
    expect(
      Math.abs(bound.gross - CEILING_2028_MFJ_TIER4),
      `gross ${bound.gross} should land on the 2028 MFJ tier-4 ceiling ${CEILING_2028_MFJ_TIER4}`,
    ).toBeLessThan(50);

    // Same live cap, an ask that fits well under it.
    const unbound = run(50_000);
    expect(unbound.gross, "the full $50K ask converts").toBeCloseTo(50_000, 0);
    expect(unbound.requested, "and that ask is what was requested").toBeCloseTo(50_000, 0);
    expect(unbound.limitedBy, "nothing limited it").toBeNull();
    expect(unbound.irmaaCapTier, "so no tier is named").toBeNull();
  });

  it("emits a $0 drill row rather than dropping the conversion", () => {
    // The "already past the ceiling" household: a $300K pension alone clears
    // the tier-0 ceiling, so the right answer is to convert nothing. Nothing
    // converted used to mean nothing REPORTED — the technique vanished from the
    // tax detail and read as a broken feature instead of an enforced cap.
    const years = runProjection(
      scenario({
        clientDob: "1958-01-01",
        spouseDob: "1959-01-01",
        filingStatus: "married_joint",
        medicareCoverage: [coverage("client"), coverage("spouse")],
        conversion: cappedFixedAmount(600_000, 0),
        checkingValue: 500_000,
        incomes: [pension(300_000)],
      }),
    );

    const y2026 = years.find((y) => y.year === 2026)!;
    const row = y2026.taxDetail?.bySource["roth_conversion:rc-cap"];

    expect(row, "the drill row must exist even at $0").toBeDefined();
    expect(row!.amount, "and it reports $0, not a phantom amount").toBe(0);
    expect(row!.type).toBe("ordinary_income");
    // The reason rides on the ROW, not on a per-conversion lookup: the cap is a
    // per-year outcome and the drill's context is built once for all years.
    expect(row!.irmaaCapTier, "the row carries the tier that bound").toBe(0);

    // The conversion summary agrees, and still records the untouched ask.
    const conv = (y2026.rothConversions ?? [])[0];
    expect(conv, "the conversion must not vanish from the year either").toBeDefined();
    expect(conv!.gross).toBe(0);
    expect(conv!.limitedBy).toBe("irmaa");
    expect(conv!.requested, "the $600K ask survives even when nothing converts").toBeCloseTo(
      600_000,
      0,
    );
  });
});
