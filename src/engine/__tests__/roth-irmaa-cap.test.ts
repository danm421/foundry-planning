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
 * ⚠️ Two of these three tests are RED until Task 6 makes the ceiling bind.
 * Task 5 only RESOLVES the ceiling; nothing consumes it yet. The enrollment-gate
 * test is the negative control: it asserts the cap does NOT bind, so it is green
 * now and must STAY green once the sizing starts consuming the ceiling.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember, MedicareCoverage, RothConversion } from "../types";
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
        id: "acc-ira",
        name: "Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 3_000_000,
        basis: 0,
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
    incomes: [],
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
      taxEngineMode: "bracket",
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
