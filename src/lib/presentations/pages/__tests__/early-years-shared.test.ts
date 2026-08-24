import { describe, it, expect } from "vitest";
import { largestMovableDeferral, deltaSavingsRuleMutation } from "../early-years-shared";
import type { ClientData, Income, SavingsRule } from "@/engine/types";

function rule(over: Partial<SavingsRule> & { accountId: string }): SavingsRule {
  return {
    id: over.accountId + "-r",
    annualAmount: 0,
    isDeductible: true,
    startYear: 2020,
    endYear: 2060,
    ...over,
  };
}

function salary(annualAmount: number, over: Partial<Income> = {}): Income {
  return {
    id: "i1",
    type: "salary",
    name: "Salary",
    annualAmount,
    startYear: 2020,
    endYear: 2060,
    growthRate: 0,
    owner: "client",
    ...over,
  } as Income;
}

function tree(rules: SavingsRule[], incomes: Income[] = [salary(120_000)]): ClientData {
  return {
    planSettings: { planStartYear: 2026, inflationRate: 0.03 },
    savingsRules: rules,
    incomes,
  } as unknown as ClientData;
}

const spec = (over: Record<string, unknown> = {}) => ({
  key: "waiting-1",
  amount: { mode: "household-percent" as const, percent: 0.03 },
  startYear: 2031,
  ...over,
});

describe("largestMovableDeferral", () => {
  it("returns null when nothing on the plan can be moved", () => {
    expect(largestMovableDeferral(tree([]), 2026)).toBeNull();
    expect(
      largestMovableDeferral(tree([rule({ accountId: "a1", contributeMax: true })]), 2026),
    ).toBeNull();
  });

  it("picks the largest movable account in DOLLARS, not in percent", () => {
    const data = tree(
      [
        rule({ id: "r1", accountId: "client-401k", annualPercent: 0.06 }),
        rule({ id: "r2", accountId: "spouse-401k", annualPercent: 0.1 }),
      ],
      [salary(345_000), salary(160_000, { id: "i2", owner: "spouse" })],
    );
    // With no familyMembers on the tree both accounts fall back to the HOUSEHOLD
    // base, so this fixture proves only the reduce; the owner-slice case is
    // covered in deferral-rules.test.ts.
    expect(largestMovableDeferral(data, 2026)?.accountId).toBe("spouse-401k");
  });
});

describe("deltaSavingsRuleMutation", () => {
  it("returns nothing when no account can carry the increase", () => {
    expect(deltaSavingsRuleMutation(tree([]), spec())).toEqual([]);
  });

  it("adds a SECOND rule and leaves the existing one alone", () => {
    const data = tree([rule({ accountId: "a1", annualPercent: 0.08 })]);
    const [m] = deltaSavingsRuleMutation(data, spec());
    expect(m.kind).toBe("savings-rule-upsert");
    expect((m as { id: string }).id).toBe("early-years-delta:waiting-1");
    expect((m as { value: SavingsRule }).value.accountId).toBe("a1");
    expect(data.savingsRules[0].annualPercent).toBe(0.08);
  });

  it("expresses a household-percent delta as a percent on a percent-mode account", () => {
    const data = tree([rule({ accountId: "a1", annualPercent: 0.08 })]);
    const { value } = deltaSavingsRuleMutation(data, spec())[0] as { value: SavingsRule };
    expect(value.annualPercent).toBeCloseTo(0.03, 9);
    expect(value.annualAmount).toBe(0);
  });

  it("expresses a household-percent delta as DOLLARS on a flat-dollar account", () => {
    const data = tree([rule({ accountId: "a1", annualAmount: 12_000 })]);
    const { value } = deltaSavingsRuleMutation(data, spec())[0] as { value: SavingsRule };
    expect(value.annualAmount).toBeCloseTo(3_600, 6);
    expect(value.annualPercent).toBeNull();
  });

  it("always writes a fixed dollar delta as dollars, whatever the account's mode", () => {
    const data = tree([rule({ accountId: "a1", annualPercent: 0.08 })]);
    const { value } = deltaSavingsRuleMutation(
      data,
      spec({ amount: { mode: "annual-dollars", annualAmount: 6_000 }, startYear: 2026 }),
    )[0] as { value: SavingsRule };
    expect(value.annualAmount).toBe(6_000);
    expect(value.annualPercent).toBeNull();
  });

  it("ZEROES every employer-match field (R1: a cloned match double-pays the employer)", () => {
    const data = tree([
      rule({
        accountId: "a1",
        annualPercent: 0.08,
        employerMatchPct: 0.5,
        employerMatchCap: 0.06,
      }),
    ]);
    const { value } = deltaSavingsRuleMutation(data, spec())[0] as { value: SavingsRule };
    expect(value.employerMatchPct).toBeUndefined();
    expect(value.employerMatchCap).toBeUndefined();
    expect(value.employerMatchAmount).toBeUndefined();
  });

  it("clones the tax treatment of the rule already on the account", () => {
    const data = tree([
      rule({
        accountId: "a1",
        annualPercent: 0.08,
        isDeductible: false,
        rothPercent: 0.5,
        applyContributionLimit: false,
      }),
    ]);
    const { value } = deltaSavingsRuleMutation(data, spec())[0] as { value: SavingsRule };
    expect(value.isDeductible).toBe(false);
    expect(value.rothPercent).toBe(0.5);
    expect(value.applyContributionLimit).toBe(false);
  });

  it("never inherits a growth rate — a delta is the instruction the advisor typed", () => {
    const data = tree([rule({ accountId: "a1", annualAmount: 12_000, growthRate: 0.03 })]);
    const { value } = deltaSavingsRuleMutation(data, spec())[0] as { value: SavingsRule };
    expect(value.growthRate).toBeUndefined();
  });

  it("ends when the existing rule ends unless told otherwise", () => {
    const data = tree([rule({ accountId: "a1", annualPercent: 0.08, endYear: 2055 })]);
    const open = deltaSavingsRuleMutation(data, spec())[0] as { value: SavingsRule };
    expect(open.value.endYear).toBe(2055);
    const windowed = deltaSavingsRuleMutation(data, spec({ endYear: 2040 }))[0] as {
      value: SavingsRule;
    };
    expect(windowed.value.endYear).toBe(2040);
  });

  it("returns nothing for a window that closes before it opens", () => {
    const data = tree([rule({ accountId: "a1", annualPercent: 0.08, endYear: 2030 })]);
    expect(deltaSavingsRuleMutation(data, spec({ startYear: 2036 }))).toEqual([]);
  });
});
