/**
 * Integration tests for the grantor irrevocable trust distribution pass.
 *
 * IDGTs / SLATs: income is already on the household 1040 (existing grantor-trust
 * income pipeline). The new mechanic is purely a cash movement:
 *   trust checking → household checking (when beneficiaryKind === "household")
 *   trust checking → exits projection (when beneficiaryKind === "non_household")
 *
 * Critical correctness gates (from the plan):
 *  1. Tax neutrality: household tax is the same whether or not a distribution fires.
 *  2. Trust tax zero: grantor trusts must NOT appear in trustTaxByEntity.
 *  3. Cash conservation: trust checking decreases by dist amount; household checking
 *     increases by the same amount (for household beneficiary).
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, EntitySummary, Account, PlanSettings, FamilyMember, ClientInfo } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Minimal fixtures ─────────────────────────────────────────────────────────

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2028,
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

// Household checking — where household cash flows
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

// Trust checking — where trust cash lives (entity-owned by the IDGT)
const trustChecking: Account = {
  id: "trust-checking",
  name: "IDGT Checking",
  category: "cash",
  subType: "checking",
  value: 50_000,
  basis: 50_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "idgt", percent: 1 }],
  isDefaultChecking: true,
};

// Trust brokerage — taxable, for pct_liquid mode
const trustBrokerage: Account = {
  id: "trust-brokerage",
  name: "IDGT Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 200_000,
  basis: 100_000,
  growthRate: 0.06,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "idgt", percent: 1 }],
};

// Spouse-as-beneficiary family member (used as the income beneficiary of the SLAT/IDGT).
// Relationship "other" is used because FamilyMember.relationship only covers non-spouse kin.
const spouseFm: FamilyMember = {
  id: "fm-spouse",
  relationship: "other",
  role: "other",
  firstName: "Bob",
  lastName: "Test",
  dateOfBirth: "1975-06-01",
};

// IDGT entity — grantor irrevocable trust with household beneficiary (spouse-as-FM).
const idgtEntity: EntitySummary = {
  id: "idgt",
  includeInPortfolio: true,
  isGrantor: true,
  entityType: "trust",
  isIrrevocable: true,
  distributionMode: "fixed",
  distributionAmount: 20_000,
  distributionPercent: null,
  // Point to spouseFm so the engine routes DNI to household.
  incomeBeneficiaries: [{ familyMemberId: "fm-spouse", householdRole: "spouse", percentage: 100 }],
};

/** Build minimal ClientData with a grantor irrevocable trust. */
function mkData(overrides: Partial<ClientData> & { entity?: Partial<EntitySummary> } = {}): ClientData {
  const { entity: entityOverride, ...rest } = overrides;
  const entity = entityOverride ? { ...idgtEntity, ...entityOverride } : idgtEntity;
  return {
    client,
    accounts: [hhChecking, trustChecking, trustBrokerage],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [spouseFm],
    entities: [entity],
    giftEvents: [],
    ...rest,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("grantor trust distribution pass", () => {
  it("trust is absent from trustTaxByEntity (no trust-level tax)", () => {
    const data = mkData();
    const years = runProjection(data);
    for (const y of years) {
      // Grantor trusts never appear in the non-grantor tax map.
      expect(y.trustTaxByEntity?.has("idgt") ?? false).toBe(false);
    }
  });

  it("fixed distribution: trust checking decreases; household checking increases", () => {
    const data = mkData({ entity: { distributionMode: "fixed", distributionAmount: 20_000 } });
    const years = runProjection(data);
    const y0 = years[0];

    // Trust checking is debited — it started at 50_000, growth is 0, so should be 30_000.
    const trustCheckingLedger = y0.accountLedgers["trust-checking"];
    expect(trustCheckingLedger).toBeDefined();
    expect(trustCheckingLedger.endingValue).toBeCloseTo(30_000, 0);

    // Household checking is credited — it started at 100_000 (growth=0), so should be 120_000
    // (100_000 baseline + 20_000 inflow, before any tax debits; checking balance changes
    // reflect all cash activity so we check it went UP by ~20_000 vs no-distribution case).
    const hhCheckingLedger = y0.accountLedgers["hh-checking"];
    expect(hhCheckingLedger).toBeDefined();
    // Checking increased relative to no-distribution scenario: get baseline first.
    const noDistData = mkData({ entity: { distributionMode: null } });
    const noDistYears = runProjection(noDistData);
    const noDistHhLedger = noDistYears[0].accountLedgers["hh-checking"];
    const delta = hhCheckingLedger.endingValue - noDistHhLedger.endingValue;
    expect(delta).toBeCloseTo(20_000, 0);
  });

  it("tax neutrality: household tax is unchanged by distribution", () => {
    // Distribution is a cash transfer, not a taxable event — household tax should be identical.
    const withDistData = mkData({ entity: { distributionMode: "fixed", distributionAmount: 20_000 } });
    const noDistData = mkData({ entity: { distributionMode: null } });

    const withDistYears = runProjection(withDistData);
    const noDistYears = runProjection(noDistData);

    for (let i = 0; i < withDistYears.length; i++) {
      const taxWith = withDistYears[i].expenses.taxes;
      const taxWithout = noDistYears[i].expenses.taxes;
      // Must be equal within floating-point rounding.
      expect(taxWith).toBeCloseTo(taxWithout, 0);
    }
  });

  it("non-household beneficiary: trust cash debited, household cash unchanged", () => {
    const data = mkData({
      entity: {
        distributionMode: "fixed",
        distributionAmount: 15_000,
        incomeBeneficiaries: [{ externalBeneficiaryId: "ext-charity", percentage: 100 }],
      },
    });
    const years = runProjection(data);
    const y0 = years[0];

    // Trust checking debited
    const trustLedger = y0.accountLedgers["trust-checking"];
    expect(trustLedger.endingValue).toBeCloseTo(35_000, 0);

    // Household checking unchanged relative to no-distribution baseline
    const noDistData = mkData({ entity: { distributionMode: null } });
    const noDistYears = runProjection(noDistData);
    const delta =
      y0.accountLedgers["hh-checking"].endingValue -
      noDistYears[0].accountLedgers["hh-checking"].endingValue;
    expect(delta).toBeCloseTo(0, 0);
  });

  it("pct_liquid mode: distribution proportional to trust liquid assets", () => {
    // Trust checking: 50_000 | Trust brokerage: 200_000 at year start (no growth in y0 check)
    // 5% pct_liquid → target = 0.05 * (50_000 + 200_000 * 1.06) = 0.05 * 262_000 = 13_100
    // Since the brokerage grows 6% before the dist pass runs, we just check direction + range.
    const data = mkData({
      entity: {
        distributionMode: "pct_liquid",
        distributionPercent: 0.05,
        distributionAmount: null,
      },
    });
    const years = runProjection(data);
    const y0 = years[0];

    // Household got some cash
    const noDistData = mkData({ entity: { distributionMode: null } });
    const noDistYears = runProjection(noDistData);
    const delta =
      y0.accountLedgers["hh-checking"].endingValue -
      noDistYears[0].accountLedgers["hh-checking"].endingValue;
    // Should be positive and in a plausible range (roughly 5% of ~262k ≈ 13k)
    expect(delta).toBeGreaterThan(10_000);
    expect(delta).toBeLessThan(20_000);
  });

  it("shortfall warning emitted when trust has insufficient cash for fixed dist", () => {
    // Trust checking only has 5_000 but we request 50_000
    const smallCashChecking: Account = { ...trustChecking, value: 5_000, basis: 5_000 };
    // No brokerage so the actual amount is capped at 5_000
    const data: ClientData = {
      client,
      accounts: [hhChecking, smallCashChecking],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [spouseFm],
      entities: [{
        ...idgtEntity,
        distributionMode: "fixed",
        distributionAmount: 50_000,
      }],
      giftEvents: [],
    };
    const years = runProjection(data);
    const y0 = years[0];
    const warnings = y0.trustWarnings ?? [];
    expect(warnings.some((w) => w.code === "trust_distribution_insufficient_liquid" && w.entityId === "idgt")).toBe(true);
    // Trust checking is fully drained at the cap (no negative balance, no overdraw).
    expect(y0.accountLedgers["trust-checking"].endingValue).toBeCloseTo(0, 0);
  });

  it("distributionMode null: no cash movement, no warnings", () => {
    const data = mkData({ entity: { distributionMode: null } });
    const years = runProjection(data);
    for (const y of years) {
      const warnings = y.trustWarnings ?? [];
      expect(warnings.filter((w) => "entityId" in w && w.entityId === "idgt")).toHaveLength(0);
    }
  });
});

// ── Grantor-flip propagation mechanism ───────────────────────────────────────
//
// Targets the engine plumbing in projection.ts that re-derives the
// nonGrantorTrusts / grantorTrusts classification each year against the
// post-death-event entity list. Smaller scope than the IDGT/SLAT integration
// test — just proves an entity starting as `isGrantor: true` flips into the
// non-grantor trust-tax pass starting in the year after the grantor's death.

describe("grantor-flip propagation through projection year loop", () => {
  // Trust-bracket fixtures — required so the post-flip year produces a
  // non-zero trustTax.total (otherwise the assertion below could pass
  // vacuously). Compressed 2026 1041 ordinary brackets + §1(h) cap-gains.
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
      ira401kElective: 23500, ira401kCatchup50: 7500, ira401kCatchup6063: 11250,
      iraTradLimit: 7000, iraCatchup50: 1000,
      simpleLimitRegular: 17000, simpleCatchup50: 4000,
      hsaLimitSelf: 4400, hsaLimitFamily: 8750, hsaCatchup55: 1000,
    },
  };

  it("trust appears in trustTaxByEntity only AFTER the grantor's death year", () => {
    // Client born 1951 + lifeExpectancy 76 → dies in 2027. Spouse born 1953,
    // default fallback (95) → spouse alive through planEnd=2030. The trust
    // starts grantor (no trustTax row) and must flip mid-projection.
    const dyingClient: ClientInfo = {
      firstName: "Iris", lastName: "Test",
      dateOfBirth: "1951-01-01",
      retirementAge: 65, planEndAge: 95,
      filingStatus: "married_joint",
      lifeExpectancy: 76,
      spouseName: "Sam Test",
      spouseDob: "1953-01-01",
      spouseRetirementAge: 65,
    };
    // Big enough corpus + realization profile to push the trust over the
    // compressed 37% bracket post-flip (so tax > 0 is non-trivial).
    const trustBrok: Account = {
      id: "idgt-brok",
      name: "IDGT Brokerage",
      category: "taxable", subType: "brokerage",
      value: 2_000_000, basis: 2_000_000,
      growthRate: 0.06, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "idgt-grantor-flip", percent: 1 }],
      realization: {
        pctOrdinaryIncome: 0.6, pctQualifiedDividends: 0.15,
        pctLtCapitalGains: 0.25, pctTaxExempt: 0, turnoverPct: 0,
      },
    };
    const trustCheckingAcct: Account = {
      id: "idgt-flip-checking",
      name: "IDGT Checking",
      category: "cash", subType: "checking",
      value: 50_000, basis: 50_000,
      growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "entity", entityId: "idgt-grantor-flip", percent: 1 }],
      isDefaultChecking: true,
    };
    const idgtFlip: EntitySummary = {
      id: "idgt-grantor-flip",
      includeInPortfolio: true,
      isGrantor: true,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: null,
      distributionAmount: null,
      distributionPercent: null,
      incomeBeneficiaries: [],
    };

    const data: ClientData = {
      client: dyingClient,
      accounts: [hhChecking, trustCheckingAcct, trustBrok],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...planSettings, planStartYear: 2026, planEndYear: 2030 },
      familyMembers: [],
      entities: [idgtFlip],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };

    const years = runProjection(data);
    const y2026 = years.find((y) => y.year === 2026);
    const y2028 = years.find((y) => y.year === 2028);
    expect(y2026).toBeDefined();
    expect(y2028).toBeDefined();

    // Pre-death (grantor regime): no per-trust tax row.
    expect(y2026!.trustTaxByEntity?.has("idgt-grantor-flip") ?? false).toBe(false);

    // Post-flip (year after death): trust now classified non-grantor → row
    // exists with positive total. Proves projection.ts re-derives the trust
    // classification against the post-flip currentEntities, not against
    // the original data.entities snapshot.
    const postRow = y2028!.trustTaxByEntity?.get("idgt-grantor-flip");
    expect(postRow).toBeDefined();
    expect(postRow!.total).toBeGreaterThan(0);
  });
});

// ── Asset-transaction sale routing for trust-owned accounts ─────────────────
//
// Targets the bug where the trust-tax wire-in built its account→entity lookup
// from `workingAccounts` AFTER the sale step had already removed the sold
// account. Trust-owned sales silently fell back to household
// `taxDetail.capitalGains` instead of routing to the trust 1041.
//
// These tests prove the sold-account ownership lookup resolves correctly so
// the gain is recognized at the trust and excluded from the household 1040.

describe("asset-transaction sale routing for trust-owned accounts", () => {
  // 2026 compressed Form 1041 ordinary + §1(h) LTCG brackets — without these
  // the trust-tax engine computes $0 federal cap-gains tax (no brackets), so
  // the assertion `federalCapGainsTax > 0` would pass vacuously.
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
      ira401kElective: 23500, ira401kCatchup50: 7500, ira401kCatchup6063: 11250,
      iraTradLimit: 7000, iraCatchup50: 1000,
      simpleLimitRegular: 17000, simpleCatchup50: 4000,
      hsaLimitSelf: 4400, hsaLimitFamily: 8750, hsaCatchup55: 1000,
    },
  };

  // Non-grantor SLAT — accumulating, no distributions. Trust pays its own
  // 1041 tax on retained gains.
  const accumulatingSlat: EntitySummary = {
    id: "slat-3",
    includeInPortfolio: true,
    isGrantor: false,
    entityType: "trust",
    trustSubType: "slat",
    isIrrevocable: true,
    grantor: "client",
    distributionMode: null,
    distributionAmount: null,
    distributionPercent: null,
    incomeBeneficiaries: [],
  };

  // Trust-owned business asset: $5M value, $1M basis → $4M gain on full sale.
  const trustBusiness: Account = {
    id: "sale-slat-business",
    name: "SLAT-owned business",
    category: "business",
    subType: "operating_business",
    value: 5_000_000,
    basis: 1_000_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: "slat-3", percent: 1 }],
  };

  // Trust checking — required so trust tax has somewhere to be debited from.
  const trustCheckingAcct: Account = {
    id: "slat-3-checking",
    name: "SLAT Checking",
    category: "cash",
    subType: "checking",
    value: 200_000,
    basis: 200_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: "slat-3", percent: 1 }],
    isDefaultChecking: true,
  };

  it("100% sale of trust-owned business: gain recognized at trust, NOT on household 1040", () => {
    const data: ClientData = {
      client,
      accounts: [hhChecking, trustCheckingAcct, trustBusiness],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...planSettings, planStartYear: 2026, planEndYear: 2030 },
      familyMembers: [],
      entities: [accumulatingSlat],
      taxYearRows: [taxYearRow],
      giftEvents: [],
      assetTransactions: [
        {
          id: "sale-1",
          name: "Sell SLAT business",
          type: "sell",
          year: 2030,
          accountId: "sale-slat-business",
          // Proceeds land in trust checking so cash-conservation stays clean.
          proceedsAccountId: "slat-3-checking",
        },
      ],
    };

    const years = runProjection(data);
    const y2030 = years.find((y) => y.year === 2030);
    expect(y2030).toBeDefined();

    // Trust 1041 row: $4M gain → federal cap-gains tax > $700K, NIIT > $100K.
    const trustRow = y2030!.trustTaxByEntity?.get("slat-3");
    expect(trustRow).toBeDefined();
    expect(trustRow!.recognizedCapGains).toBeGreaterThan(3_900_000);
    expect(trustRow!.recognizedCapGains).toBeLessThan(4_100_000);
    expect(trustRow!.federalCapGainsTax).toBeGreaterThan(700_000);
    expect(trustRow!.niit).toBeGreaterThan(100_000);
    expect(trustRow!.total).toBeGreaterThan(800_000);

    // Household 1040: cap-gains line excludes the trust's gain. Per-source
    // breakdown still records the sale, but it should not double-attribute
    // the gain into household taxable cap-gains.
    expect(y2030!.taxDetail).toBeDefined();
    expect(y2030!.taxDetail!.capitalGains).toBeLessThan(100_000);
  });

  it("household-owned account sale: gain stays on household 1040 (regression sentinel)", () => {
    // Same fixture but the business is household-owned (no ownerEntityId).
    // The fix must NOT change behavior for household sales.
    const householdBusiness: Account = {
      ...trustBusiness,
      id: "sale-hh-business",
      owners: [],
    };
    const data: ClientData = {
      client,
      accounts: [hhChecking, householdBusiness],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: { ...planSettings, planStartYear: 2026, planEndYear: 2030 },
      familyMembers: [],
      entities: [],
      taxYearRows: [taxYearRow],
      giftEvents: [],
      assetTransactions: [
        {
          id: "sale-2",
          name: "Sell household business",
          type: "sell",
          year: 2030,
          accountId: "sale-hh-business",
        },
      ],
    };

    const years = runProjection(data);
    const y2030 = years.find((y) => y.year === 2030);
    expect(y2030).toBeDefined();

    // No trust → no trustTaxByEntity row.
    expect(y2030!.trustTaxByEntity?.has("slat-3") ?? false).toBe(false);

    // Household sees the full $4M gain on the 1040.
    expect(y2030!.taxDetail).toBeDefined();
    expect(y2030!.taxDetail!.capitalGains).toBeGreaterThan(3_900_000);
  });
});
