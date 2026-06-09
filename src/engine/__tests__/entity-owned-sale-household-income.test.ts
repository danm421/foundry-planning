/**
 * Entity-owned asset sales must NOT leak into household cash-flow income.
 *
 * Sentinel for the "trust sale proceeds leak into household cashflow" bug:
 * when an asset held INSIDE a fully entity-owned account (e.g. a trust) is
 * sold, applyAssetSales routes the net proceeds to the OWNING ENTITY's
 * checking (asset-transactions.ts proceeds routing) and the entity cash-flow
 * rollup excludes them (isSaleProceeds). The household technique-income path
 * must mirror that predicate — otherwise the same dollars are double-counted:
 * once in the trust's cash balance, once as household "Other income".
 *
 * Mirrors the confirmed repro (an IDGT / grantor trust): the cash belongs to
 * the trust regardless of grantor status, so it stays out of household income
 * even though the gain is taxed on the household 1040. A household-owned sale
 * in the SAME year still surfaces — that's the regression guard.
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  ClientData,
  EntitySummary,
  Account,
  AssetTransaction,
  PlanSettings,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

const planSettings: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2032,
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

// Trust's own checking — fully entity-owned + isDefaultChecking, so it becomes
// the proceeds destination for the trust's own sales (entityCheckingByEntityId).
const trustChecking: Account = {
  id: "idgt-checking",
  name: "IDGT Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "idgt-1", percent: 1 }],
  isDefaultChecking: true,
};

// Household-owned real estate — its sale SHOULD surface as household income.
const hhRealEstate: Account = {
  id: "hh-realestate",
  name: "Household Rental",
  category: "real_estate",
  subType: "rental",
  titlingType: "jtwros",
  value: 300_000,
  basis: 200_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [
    { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
    { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
  ],
};

// Trust-owned real estate — its sale must NOT surface as household income.
const trustRealEstate: Account = {
  id: "idgt-realestate",
  name: "IDGT Rental",
  category: "real_estate",
  subType: "rental",
  titlingType: "jtwros",
  value: 500_000,
  basis: 300_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "entity", entityId: "idgt-1", percent: 1 }],
};

const sellHousehold: AssetTransaction = {
  id: "tx-hh-sale",
  name: "Sell Household Rental",
  type: "sell",
  year: 2030,
  accountId: "hh-realestate",
};

const sellTrust: AssetTransaction = {
  id: "tx-trust-sale",
  name: "Sell IDGT Rental",
  type: "sell",
  year: 2030,
  accountId: "idgt-realestate",
};

const taxYearRow: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [{ from: 0, to: null, rate: 0.1 }],
    single: [{ from: 0, to: null, rate: 0.1 }],
    head_of_household: [{ from: 0, to: null, rate: 0.1 }],
    married_separate: [{ from: 0, to: null, rate: 0.1 }],
  },
  capGainsBrackets: {
    married_joint: { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single: { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [
    { from: 0, to: 3300, rate: 0.1 },
    { from: 3300, to: 12000, rate: 0.24 },
    { from: 12000, to: 16250, rate: 0.35 },
    { from: 16250, to: null, rate: 0.37 },
  ],
  trustCapGainsBrackets: [
    { from: 0, to: 3350, rate: 0 },
    { from: 3350, to: 16300, rate: 0.15 },
    { from: 16300, to: null, rate: 0.2 },
  ],
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

describe("Entity-owned asset sale — household income exclusion", () => {
  it("excludes trust-owned sale proceeds from household income while keeping household-owned proceeds", () => {
    const idgt: EntitySummary = {
      id: "idgt-1",
      includeInPortfolio: true,
      isGrantor: true, // mirrors the confirmed repro (IDGT)
      entityType: "trust",
      trustSubType: "irrevocable",
      isIrrevocable: true,
      grantor: "client",
      distributionMode: null,
      distributionAmount: null,
      distributionPercent: null,
      incomeBeneficiaries: [],
    };

    const data: ClientData = {
      client,
      accounts: [hhChecking, trustChecking, hhRealEstate, trustRealEstate],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [],
      entities: [idgt],
      assetTransactions: [sellHousehold, sellTrust],
      taxYearRows: [taxYearRow],
      giftEvents: [],
    };

    const years = runProjection(data);
    const year2030 = years.find((y) => y.year === 2030);
    expect(year2030).toBeDefined();

    const bySource = year2030!.income.bySource;

    // Household-owned sale still surfaces (regression guard).
    expect(bySource["technique-proceeds:tx-hh-sale"]).toBeCloseTo(300_000, 2);

    // Trust-owned sale proceeds are absent — they belong to the trust's cash.
    expect(bySource["technique-proceeds:tx-trust-sale"]).toBeUndefined();

    // Household "Other income" reflects only the household sale, not the trust's.
    expect(year2030!.income.other).toBeCloseTo(300_000, 2);
  });
});
