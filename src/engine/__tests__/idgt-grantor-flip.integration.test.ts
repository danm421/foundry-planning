/**
 * IDGT grantor-flip integration test — Task 15 (Phase 4).
 *
 * Verifies the income-tax regime switch when an Intentionally Defective
 * Grantor Trust's grantor dies mid-projection:
 *
 *   Pre-death year (client alive): trust is grantor-classified
 *     → trust income flows through household 1040
 *     → no separate trust-level tax pass
 *     → trustTaxByEntity has no entry for the IDGT.
 *
 *   Post-death year (after the grantor dies): trust flips to non-grantor
 *     → trust pays its own income tax under the compressed 1041 brackets
 *     → trustTaxByEntity carries a positive total for the IDGT.
 *
 * Death is configured via `lifeExpectancy` on `ClientInfo` (= birthYear +
 * lifeExpectancy → death year). Pattern mirrors the projection-side death
 * config in `estate-tax-integration.test.ts` ("couple survivor's death with
 * stashed DSUE..." case).
 *
 * Hand-constructed minimal `ClientData` follows the Task 14 prior-art file
 * `slat-40-year.integration.test.ts` — the compressed 1041 brackets + NIIT
 * row are required so the post-flip trust tax is non-zero.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  PlanSettings,
  ClientInfo,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";

// ── Shared minimal scaffolding ──────────────────────────────────────────────

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2040,
};

// Client born 1951 → age 75 at planStart=2026; lifeExpectancy 76 → dies 2027.
// Spouse born 1953, default spouseLifeExpectancy fallback (95) → survives well
// past planEndYear=2040, so the projection continues post-death.
const client: ClientInfo = {
  firstName: "Iris",
  lastName: "Test",
  dateOfBirth: "1951-01-01",
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "married_joint",
  lifeExpectancy: 76,
  spouseName: "Sam Test",
  spouseDob: "1953-01-01",
  spouseRetirementAge: 65,
  // Leave spouseLifeExpectancy unset → death-event fallback of 95 keeps spouse
  // alive through the entire 2026..2040 horizon.
};

// Household checking — required so any household-side cash flows have a
// destination account.
const hhChecking: Account = {
  id: "hh-checking",
  name: "Household Checking",
  category: "cash",
  subType: "checking",
  owner: "joint",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
};

// 60/15/25 OI/QDIV/LTCG realization profile at 6% growth on a $2M corpus
// generates ~$72K ordinary + ~$18K dividends per year — well above the
// compressed-bracket NIIT threshold once the trust flips to non-grantor.
const brokerageRealization = {
  pctOrdinaryIncome: 0.6,
  pctQualifiedDividends: 0.15,
  pctLtCapitalGains: 0.25,
  pctTaxExempt: 0,
  turnoverPct: 0,
};

const idgtChecking: Account = {
  id: "idgt-1-checking",
  name: "IDGT Checking",
  category: "cash",
  subType: "checking",
  owner: "joint",
  value: 50_000,
  basis: 50_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  ownerEntityId: "idgt-1",
};

const idgtBrokerage: Account = {
  id: "idgt-1-brokerage",
  name: "IDGT Brokerage",
  category: "taxable",
  subType: "brokerage",
  owner: "joint",
  value: 2_000_000,
  basis: 2_000_000,
  growthRate: 0.06,
  rmdEnabled: false,
  ownerEntityId: "idgt-1",
  realization: brokerageRealization,
};

// Trust bracket fixtures — 2026 compressed Form 1041 ordinary + §1(h) LTCG.
// Without these the engine falls back to empty brackets and computes $0
// federal trust tax, defeating the post-flip assertion.
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

// ── Test ────────────────────────────────────────────────────────────────────

describe("IDGT grantor flip", () => {
  it("pre-death year: income on household 1040 (no trust tax); post-flip year: trust pays its own tax", () => {
    // IDGT: irrevocable + isGrantor=true + grantor="client" + full
    // accumulation. At the client's death (2027), grantor-succession should
    // flip isGrantor:true→false and the trust should start owing tax under
    // the compressed 1041 brackets in the post-flip years.
    const idgt: EntitySummary = {
      id: "idgt-1",
      includeInPortfolio: true,
      isGrantor: true,
      entityType: "trust",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: null, // full accumulation
      distributionAmount: null,
      distributionPercent: null,
      incomeBeneficiaryFamilyMemberId: null,
      incomeBeneficiaryExternalId: null,
    };

    const data: ClientData = {
      client,
      accounts: [hhChecking, idgtChecking, idgtBrokerage],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [idgt],
      taxYearRows: [taxYearRow],
    };

    const years = runProjection(data);

    // Pre-death (2026, client alive): trust is grantor → income flows
    // through the household 1040 → no per-entity trust tax.
    const yearPre = years.find((y) => y.year === 2026);
    expect(yearPre).toBeDefined();
    expect(yearPre!.trustTaxByEntity?.get("idgt-1")?.total ?? 0).toBe(0);

    // Post-flip (2028, year after client's 2027 death): trust is now
    // non-grantor → compressed 1041 brackets apply on retained ordinary
    // income → trust tax > 0.
    const yearPost = years.find((y) => y.year >= 2028);
    expect(yearPost).toBeDefined();
    expect(yearPost!.trustTaxByEntity?.get("idgt-1")?.total ?? 0).toBeGreaterThan(0);
  });
});
