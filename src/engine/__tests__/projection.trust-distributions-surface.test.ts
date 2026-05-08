/**
 * Surface-test for ProjectionYear.trustDistributionsByEntity.
 *
 * Asserts that the year-result assembly inside runProjection populates
 * `trustDistributionsByEntity` from `trustPassResult.distributionsByEntity`
 * (drawFromCash). This is what Tasks 4-5 of the Entities Cash Flow Report
 * read.
 *
 * Minimal fixture: one non-grantor trust with a `fixed` distribution policy
 * that is fully covered by available cash. The expected drawFromCash equals
 * the configured fixed amount.
 *
 * Mirrors the scaffolding pattern used by trust-tax-edge-cases.integration.test.ts.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  PlanSettings,
  FamilyMember,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2026,
};

const client = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1975-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint" as const,
  spouseName: "Bob Test",
  spouseDob: "1975-06-01",
  spouseRetirementAge: 65,
};

const hhChecking: Account = {
  id: "hh-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
  isDefaultChecking: true,
};

const spouseFm: FamilyMember = {
  id: "fm-spouse",
  relationship: "other",
  role: "other",
  firstName: "Bob",
  lastName: "Test",
  dateOfBirth: "1975-06-01",
};

const TRUST_INCOME_2026 = [
  { from: 0,     to: 3300,  rate: 0.10 },
  { from: 3300,  to: 12000, rate: 0.24 },
  { from: 12000, to: 16250, rate: 0.35 },
  { from: 16250, to: null,  rate: 0.37 },
];
const TRUST_CAP_GAINS_2026 = [
  { from: 0,     to: 3350,  rate: 0    },
  { from: 3350,  to: 16300, rate: 0.15 },
  { from: 16300, to: null,  rate: 0.20 },
];

const taxYearRow: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint:    [{ from: 0, to: null, rate: 0.10 }],
    single:           [{ from: 0, to: null, rate: 0.10 }],
    head_of_household:[{ from: 0, to: null, rate: 0.10 }],
    married_separate: [{ from: 0, to: null, rate: 0.10 }],
  },
  capGainsBrackets: {
    married_joint:    { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single:           { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household:{ zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: TRUST_INCOME_2026,
  trustCapGainsBrackets: TRUST_CAP_GAINS_2026,
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
};

describe("ProjectionYear.trustDistributionsByEntity surfacing", () => {
  it("populates per-entity drawFromCash for a non-grantor trust with a fixed distribution", () => {
    // Trust holds $200K cash, distributes $25K fixed to a household
    // beneficiary. drawFromCash = min(actual, cash) = $25K.
    const trustChecking: Account = {
      id: "t1-checking",
      name: "Trust Checking",
      category: "cash",
      subType: "checking",
      value: 200_000,
      basis: 200_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
      isDefaultChecking: true,
    };
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: "fixed",
      distributionAmount: 25_000,
      distributionPercent: null,
      incomeBeneficiaries: [
        { familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 },
      ],
    };
    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [trust],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };

    const years = runProjection(data);
    const y0 = years[0];

    // The new surfaced field is populated.
    expect(y0.trustDistributionsByEntity).toBeDefined();
    expect(y0.trustDistributionsByEntity?.get("t1")).toBe(25_000);
  });

  it("omits trustDistributionsByEntity in years with no trust pass", () => {
    // No entities → trustPassResult is null → field stays undefined.
    const data: ClientData = {
      client,
      accounts: [hhChecking],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };

    const years = runProjection(data);
    expect(years[0].trustDistributionsByEntity).toBeUndefined();
  });
});
