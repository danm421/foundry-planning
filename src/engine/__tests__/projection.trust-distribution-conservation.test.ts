/**
 * Value-conservation reconciliation for non-grantor trust distributions.
 *
 * Regression guard for audit findings H8/H9/M10:
 *  - H8: the non-grantor distribution recognized DNI + debited trust cash but
 *        never CREDITED the household beneficiary — the money left the trust and
 *        never arrived (value destroyed for the cash-funded slice).
 *  - H9: the distribution was funded on paper from taxable brokerage
 *        (drawFromTaxable) but only drawFromCash was debited — the brokerage was
 *        never drained, so once H8 credits the household the plan CREATES money.
 *  - M10: the trust-checking debit was a raw accountBalances mutation, bypassing
 *        the ledger (I1 break on trust checking).
 *
 * A 100%-household beneficiary distribution with zero trust income/growth/tax is
 * pure movement of corpus: household net worth is conserved, and household cash
 * rises by exactly the distributed amount. Both must hold together — H8 alone
 * (credit without draining the brokerage) would create money; H9 alone (drain
 * without crediting) would destroy it.
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
  titlingType: "jtwros",
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

describe("non-grantor trust distribution — value conservation (H8/H9/M10)", () => {
  it("conserves net worth and credits the household when a trust distribution is funded partly from brokerage", () => {
    // Trust holds $5K cash + $195K taxable brokerage (basis == value, no growth
    // → zero trust income, zero gain on liquidation, zero tax). It distributes
    // $50K fixed to a 100%-household beneficiary. Funding: $5K from cash, $45K
    // from brokerage. With no income/tax the distribution is pure corpus, so:
    //   - household net worth is unchanged (money moved trust → household), and
    //   - household cash rises by exactly $50K.
    const trustChecking: Account = {
      id: "t1-checking",
      name: "Trust Checking",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 5_000,
      basis: 5_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
      isDefaultChecking: true,
    };
    const trustBrokerage: Account = {
      id: "t1-brokerage",
      name: "Trust Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 195_000,
      basis: 195_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
    };
    const trust: EntitySummary = {
      id: "t1",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: "fixed",
      distributionAmount: 50_000,
      distributionPercent: null,
      incomeBeneficiaries: [
        { familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 },
      ],
    };
    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking, trustBrokerage],
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

    const totalBefore = 100_000 + 5_000 + 195_000; // $300K
    const years = runProjection(data);
    const y0 = years[0];

    // H8: the household beneficiary actually receives the $50K distribution.
    expect(y0.portfolioAssets.cash["hh-checking"]).toBeCloseTo(150_000, 2);

    // H8+H9: no money is created or destroyed — total net worth is conserved.
    // (H8 credits the household; H9 must drain the brokerage to fund it. Fixing
    // only one breaks this identity in opposite directions.)
    expect(y0.portfolioAssets.total).toBeCloseTo(totalBefore, 2);
  });
});
