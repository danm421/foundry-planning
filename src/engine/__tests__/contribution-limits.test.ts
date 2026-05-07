import { describe, it, expect } from "vitest";
import {
  applyContributionLimits,
  computeDeferralLimit,
  computeIraLimit,
  resolveAgeInYear,
} from "../contribution-limits";
import type { Account, ClientInfo, SavingsRule } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Helpers ────────────────────────────────────────────────────────────────

const PARAMS_2025: TaxYearParameters = {
  year: 2025,
  incomeBrackets: {} as TaxYearParameters["incomeBrackets"],
  capGainsBrackets: {} as TaxYearParameters["capGainsBrackets"],
  trustIncomeBrackets: [],
  trustCapGainsBrackets: [],
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 22500, married_separate: 15000 },
  amtExemption: {} as TaxYearParameters["amtExemption"],
  amtBreakpoint2628: {} as TaxYearParameters["amtBreakpoint2628"],
  amtPhaseoutStart: {} as TaxYearParameters["amtPhaseoutStart"],
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: {} as TaxYearParameters["addlMedicareThreshold"],
  niitRate: 0.038,
  niitThreshold: {} as TaxYearParameters["niitThreshold"],
  qbi: {
    thresholdMfj: 0,
    thresholdSingleHohMfs: 0,
    phaseInRangeMfj: 0,
    phaseInRangeOther: 0,
  },
  contribLimits: {
    ira401kElective: 23_500,
    ira401kCatchup50: 7_500,
    ira401kCatchup6063: 11_250,
    iraTradLimit: 7_000,
    iraCatchup50: 1_000,
    simpleLimitRegular: 0,
    simpleCatchup50: 0,
    hsaLimitSelf: 0,
    hsaLimitFamily: 0,
    hsaCatchup55: 0,
  },
};

const clientInfoAge40: ClientInfo = {
  firstName: "Alex",
  lastName: "X",
  dateOfBirth: "1985-01-01", // age 40 in 2025
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "single",
};

const clientInfoAge55: ClientInfo = {
  ...clientInfoAge40,
  dateOfBirth: "1970-01-01", // age 55
};

const clientInfoAge62: ClientInfo = {
  ...clientInfoAge40,
  dateOfBirth: "1963-01-01", // age 62 (inside 60-63 super catch-up band)
};

function acct(id: string, subType: string, ownerKind: "client" | "spouse" | "joint" = "client"): Account {
  const owners = ownerKind === "joint"
    ? [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
       { kind: "family_member" as const, familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 }]
    : [{ kind: "family_member" as const, familyMemberId: ownerKind === "client" ? LEGACY_FM_CLIENT : LEGACY_FM_SPOUSE, percent: 1 }];
  return {
    id,
    name: id,
    category: "retirement",
    subType,
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners,
  };
}

function rule(
  id: string,
  accountId: string,
  opts: { applyContributionLimit?: boolean } = {}
): SavingsRule {
  return {
    id,
    accountId,
    annualAmount: 0,
    isDeductible: true,
    applyContributionLimit: opts.applyContributionLimit ?? true,
    startYear: 2020,
    endYear: 2050,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("resolveAgeInYear", () => {
  it("returns year - birthYear for a valid DOB", () => {
    expect(resolveAgeInYear("1985-06-15", 2025)).toBe(40);
  });
  it("returns 50 when DOB is null", () => {
    expect(resolveAgeInYear(null, 2025)).toBe(50);
  });
  it("returns 50 when DOB is undefined", () => {
    expect(resolveAgeInYear(undefined, 2025)).toBe(50);
  });
  it("returns 50 for an unparseable DOB", () => {
    expect(resolveAgeInYear("not-a-date", 2025)).toBe(50);
  });
});

describe("computeDeferralLimit", () => {
  it("returns base only for age < 50", () => {
    expect(computeDeferralLimit(PARAMS_2025, 40)).toBe(23_500);
  });
  it("adds the 50+ catch-up at age 50", () => {
    expect(computeDeferralLimit(PARAMS_2025, 50)).toBe(31_000);
  });
  it("uses the super catch-up at age 60", () => {
    expect(computeDeferralLimit(PARAMS_2025, 60)).toBe(34_750);
  });
  it("uses the super catch-up at age 63", () => {
    expect(computeDeferralLimit(PARAMS_2025, 63)).toBe(34_750);
  });
  it("reverts to 50+ catch-up at age 64 (super catch-up ends)", () => {
    expect(computeDeferralLimit(PARAMS_2025, 64)).toBe(31_000);
  });
});

describe("computeIraLimit", () => {
  it("returns base only for age < 50", () => {
    expect(computeIraLimit(PARAMS_2025, 40)).toBe(7_000);
  });
  it("adds the 50+ catch-up at age 50", () => {
    expect(computeIraLimit(PARAMS_2025, 50)).toBe(8_000);
  });
});

describe("applyContributionLimits", () => {
  it("leaves under-cap contributions unchanged", () => {
    const accounts = [acct("a1", "401k")];
    const rules = [rule("r1", "a1")];
    const { cappedByRuleId, adjustments } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 10_000 },
    });
    expect(cappedByRuleId.r1).toBe(10_000);
    expect(adjustments).toHaveLength(0);
  });

  it("caps a single 401k contribution at the deferral limit", () => {
    const accounts = [acct("a1", "401k")];
    const rules = [rule("r1", "a1")];
    const { cappedByRuleId, adjustments } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 100_000 },
    });
    expect(cappedByRuleId.r1).toBe(23_500);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      ruleId: "r1",
      group: "deferral",
      originalAmount: 100_000,
      cappedAmount: 23_500,
      limit: 23_500,
    });
  });

  it("aggregates 401k + 403b into one deferral bucket", () => {
    const accounts = [acct("a1", "401k"), acct("a2", "403b"), acct("a3", "401k")];
    const rules = [rule("r1", "a1"), rule("r2", "a2"), rule("r3", "a3")];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 15_000, r2: 10_000, r3: 5_000 },
    });
    // Total = 30,000 > 23,500 cap. Scale = 23_500 / 30_000.
    const scale = 23_500 / 30_000;
    expect(cappedByRuleId.r1).toBeCloseTo(15_000 * scale, 2);
    expect(cappedByRuleId.r2).toBeCloseTo(10_000 * scale, 2);
    expect(cappedByRuleId.r3).toBeCloseTo(5_000 * scale, 2);
    const total = cappedByRuleId.r1 + cappedByRuleId.r2 + cappedByRuleId.r3;
    expect(total).toBeCloseTo(23_500, 2);
  });

  it("applies catch-up for age 55", () => {
    const accounts = [acct("a1", "401k")];
    const rules = [rule("r1", "a1")];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge55,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 100_000 },
    });
    expect(cappedByRuleId.r1).toBe(31_000);
  });

  it("applies super catch-up for age 62", () => {
    const accounts = [acct("a1", "401k")];
    const rules = [rule("r1", "a1")];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge62,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 100_000 },
    });
    expect(cappedByRuleId.r1).toBe(34_750);
  });

  it("aggregates traditional + roth IRAs into one IRA bucket", () => {
    const accounts = [acct("a1", "traditional_ira"), acct("a2", "roth_ira")];
    const rules = [rule("r1", "a1"), rule("r2", "a2")];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 5_000, r2: 5_000 },
    });
    // Total 10_000 > 7_000 cap. Scale = 0.7.
    expect(cappedByRuleId.r1).toBeCloseTo(3_500, 2);
    expect(cappedByRuleId.r2).toBeCloseTo(3_500, 2);
  });

  it("tracks 401k and IRA buckets separately for the same owner", () => {
    const accounts = [acct("a1", "401k"), acct("a2", "traditional_ira")];
    const rules = [rule("r1", "a1"), rule("r2", "a2")];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 30_000, r2: 10_000 },
    });
    expect(cappedByRuleId.r1).toBe(23_500);
    expect(cappedByRuleId.r2).toBe(7_000);
  });

  it("tracks client and spouse buckets separately", () => {
    const accounts = [acct("a1", "401k", "client"), acct("a2", "401k", "spouse")];
    const rules = [rule("r1", "a1"), rule("r2", "a2")];
    const client = { ...clientInfoAge40, spouseDob: "1985-01-01" };
    const familyMembers = [
      { id: LEGACY_FM_CLIENT, role: "client" as const, relationship: "other" as const, firstName: "Client", lastName: null, dateOfBirth: "1985-01-01" },
      { id: LEGACY_FM_SPOUSE, role: "spouse" as const, relationship: "other" as const, firstName: "Spouse", lastName: null, dateOfBirth: "1985-01-01" },
    ];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 30_000, r2: 10_000 },
      familyMembers,
    });
    // Client bucket: 30k → capped 23_500. Spouse bucket: 10k → under cap.
    expect(cappedByRuleId.r1).toBe(23_500);
    expect(cappedByRuleId.r2).toBe(10_000);
  });

  it("bypasses the cap when applyContributionLimit is false", () => {
    const accounts = [acct("a1", "401k")];
    const rules = [rule("r1", "a1", { applyContributionLimit: false })];
    const { cappedByRuleId, adjustments } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 100_000 },
    });
    expect(cappedByRuleId.r1).toBe(100_000);
    expect(adjustments).toHaveLength(0);
  });

  it("bypassed rule does not count against the cap for capped rules in the same bucket", () => {
    const accounts = [acct("a1", "401k"), acct("a2", "401k")];
    const rules = [
      rule("r1", "a1", { applyContributionLimit: false }), // bypassed
      rule("r2", "a2"), // capped
    ];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 50_000, r2: 10_000 },
    });
    expect(cappedByRuleId.r1).toBe(50_000); // untouched
    expect(cappedByRuleId.r2).toBe(10_000); // under the 23.5k cap on its own
  });

  it("ignores non-retirement accounts entirely", () => {
    const nonRetirementAcct: Account = {
      id: "brk",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const rules = [rule("r1", "brk")];
    const { cappedByRuleId, adjustments } = applyContributionLimits({
      year: 2025,
      rules,
      accounts: [nonRetirementAcct],
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 1_000_000 },
    });
    expect(cappedByRuleId.r1).toBe(1_000_000);
    expect(adjustments).toHaveLength(0);
  });

  it("skips rules outside their year range", () => {
    const accounts = [acct("a1", "401k")];
    const rules = [{ ...rule("r1", "a1"), startYear: 2030, endYear: 2035 }];
    const { cappedByRuleId, adjustments } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge40,
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 100_000 },
    });
    // Out of range → no cap applied
    expect(cappedByRuleId.r1).toBe(100_000);
    expect(adjustments).toHaveLength(0);
  });

  it("uses client (not spouse) age for joint-owned accounts", () => {
    const accounts = [acct("a1", "401k", "joint")];
    const rules = [rule("r1", "a1")];
    const { cappedByRuleId } = applyContributionLimits({
      year: 2025,
      rules,
      accounts,
      client: clientInfoAge62, // client 62 → super catch-up
      taxYearParams: PARAMS_2025,
      resolvedByRuleId: { r1: 100_000 },
    });
    expect(cappedByRuleId.r1).toBe(34_750);
  });
});
