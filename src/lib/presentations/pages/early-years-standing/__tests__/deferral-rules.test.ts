import { describe, it, expect } from "vitest";
import { deferralAccounts, householdSalary, isMovable } from "../deferral-rules";
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

/** Growth is zero so every expectation below is plain arithmetic; the engine's
 *  growth formula gets its own test. */
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

function tree(
  rules: SavingsRule[],
  incomes: Income[],
  extra: Record<string, unknown> = {},
): ClientData {
  return { savingsRules: rules, incomes, ...extra } as unknown as ClientData;
}

const account = (id: string, familyMemberId: string) => ({
  id,
  owners: [{ kind: "family_member", familyMemberId, percent: 1 }],
});

const FAMILY = [
  { id: "fm-c", role: "client" },
  { id: "fm-s", role: "spouse" },
];

describe("deferralAccounts", () => {
  it("picks up a rule already in percent-of-salary mode", () => {
    const t = tree([rule({ accountId: "a1", annualPercent: 0.08 })], [salary(120_000)]);
    expect(deferralAccounts(t, 2026)).toEqual([
      {
        accountId: "a1",
        currentPercent: 0.08,
        ownerSalary: 120_000,
        ruleCount: 1,
        contributesMax: false,
      },
    ]);
  });

  it("converts a flat-dollar rule to its implied percent of the owner's salary", () => {
    const t = tree([rule({ accountId: "a1", annualAmount: 12_000 })], [salary(120_000)]);
    expect(deferralAccounts(t, 2026)[0].currentPercent).toBeCloseTo(0.1, 9);
  });

  it("ignores a flat-dollar rule when there is no salary to divide by", () => {
    const t = tree([rule({ accountId: "a1", annualAmount: 12_000 })], [salary(0)]);
    expect(deferralAccounts(t, 2026)).toEqual([]);
  });

  it("returns every deferral account, not just the first", () => {
    const t = tree(
      [rule({ accountId: "a1", annualPercent: 0.06 }), rule({ accountId: "a2", annualPercent: 0.04 })],
      [salary(120_000)],
    );
    expect(deferralAccounts(t, 2026).map((d) => d.accountId)).toEqual(["a1", "a2"]);
  });

  it("skips a rule whose own window has not opened yet", () => {
    const t = tree(
      [rule({ accountId: "a1", annualPercent: 0.06, startYear: 2032, endYear: 2060 })],
      [salary(120_000)],
    );
    expect(deferralAccounts(t, 2026)).toEqual([]);
  });

  it("sums two rules on one account into a single entry and reports the rule count", () => {
    const t = tree(
      [
        rule({ id: "r1", accountId: "a1", annualPercent: 0.06 }),
        rule({ id: "r2", accountId: "a1", annualPercent: 0.02 }),
      ],
      [salary(120_000)],
    );
    const [only] = deferralAccounts(t, 2026);
    expect(only.currentPercent).toBeCloseTo(0.08, 9);
    expect(only.ruleCount).toBe(2);
  });

  it("counts only salary income, not business or trust income", () => {
    const t = tree(
      [rule({ accountId: "a1", annualAmount: 12_000 })],
      [salary(60_000), { ...salary(60_000), id: "i2", type: "business" } as Income],
    );
    expect(deferralAccounts(t, 2026)[0].currentPercent).toBeCloseTo(0.2, 6);
  });

  // F1 — Michael Mitchell (dev) defers $32,000 a year through two "contribute
  // the max" rules. They were invisible here, so the ladder printed "this plan
  // has no payroll retirement contributions" onto the page after the one that
  // had just reported those very dollars.
  describe("a rule set to contribute the annual maximum", () => {
    const maxed = () =>
      tree(
        [
          rule({ id: "r1", accountId: "401k", contributeMax: true }),
          rule({ id: "r2", accountId: "roth", contributeMax: true }),
        ],
        [salary(250_000, { owner: "client" })],
        { familyMembers: FAMILY, accounts: [account("401k", "fm-c"), account("roth", "fm-c")] },
      );

    it("is reported as a real deferral account", () => {
      expect(deferralAccounts(maxed(), 2026).map((a) => a.accountId)).toEqual(["401k", "roth"]);
    });

    it("is flagged as contributing the maximum", () => {
      expect(deferralAccounts(maxed(), 2026).every((a) => a.contributesMax)).toBe(true);
    });

    // The engine resolves `contributeMax` BEFORE it looks at `annualPercent`
    // (projection.ts), so writing a percent onto one of these rules changes
    // nothing — every rung would re-run the identical plan.
    it("is never movable, so the ladder cannot pretend to raise it", () => {
      expect(deferralAccounts(maxed(), 2026).some(isMovable)).toBe(false);
    });

    it("wins over a flat dollar amount sitting on the same rule", () => {
      // Cooper's IRA rule carries BOTH `annualAmount: 10_000` and
      // `contributeMax: true`. The $10,000 is dead data — reading it as the
      // rule's contribution is what put the phantom 2% into the old ladder.
      const t = tree(
        [rule({ accountId: "ira", annualAmount: 10_000, contributeMax: true })],
        [salary(505_000)],
      );
      expect(deferralAccounts(t, 2026)[0]).toMatchObject({
        currentPercent: 0,
        contributesMax: true,
      });
    });
  });

  // F2 — `applySavingsRules` resolves a percent rule against `salaryByRuleId`,
  // the ACCOUNT OWNER's salary slice. A spouse's "10%" is 10% of the spouse's
  // pay, and the ladder has to move it on that base or it delivers a fraction
  // of the rung it labels the bar with.
  describe("the salary base each account's percent is resolved against", () => {
    const twoEarners = () =>
      tree(
        [
          rule({ id: "r-s", accountId: "susan-401k", annualPercent: 0.1 }),
          rule({ id: "r-c", accountId: "cooper-401k", annualPercent: 0.04 }),
        ],
        [
          salary(345_000, { id: "i-c", owner: "client" }),
          salary(160_000, { id: "i-s", owner: "spouse" }),
        ],
        {
          familyMembers: FAMILY,
          accounts: [account("susan-401k", "fm-s"), account("cooper-401k", "fm-c")],
        },
      );

    it("is the owning spouse's own salary, not the household's", () => {
      const bySpouse = Object.fromEntries(
        deferralAccounts(twoEarners(), 2026).map((a) => [a.accountId, a.ownerSalary]),
      );
      expect(bySpouse).toEqual({ "susan-401k": 160_000, "cooper-401k": 345_000 });
    });

    it("is zero for a jointly owned account, which grounds no individual salary", () => {
      const t = tree(
        [rule({ accountId: "joint", annualPercent: 0.05 })],
        [salary(345_000, { owner: "client" })],
        {
          familyMembers: FAMILY,
          accounts: [
            {
              id: "joint",
              owners: [
                { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
                { kind: "family_member", familyMemberId: "fm-s", percent: 0.5 },
              ],
            },
          ],
        },
      );
      expect(deferralAccounts(t, 2026)[0].ownerSalary).toBe(0);
      expect(deferralAccounts(t, 2026).some(isMovable)).toBe(false);
    });

    it("falls back to the household total for a tree with no family members", () => {
      const t = tree([rule({ accountId: "a1", annualPercent: 0.08 })], [salary(120_000)]);
      expect(deferralAccounts(t, 2026)[0].ownerSalary).toBe(120_000);
    });
  });

  // The engine grows a salary from its own inflation start year before it
  // resolves a contribution against it. A base measured without that growth
  // would size the ladder's step against the wrong paycheck.
  it("grows each salary the way the engine does before using it as a base", () => {
    const t = tree(
      [rule({ accountId: "a1", annualAmount: 12_000 })],
      [salary(100_000, { growthRate: 0.03, startYear: 2024, endYear: 2060 })],
    );
    expect(householdSalary(t, 2026)).toBeCloseTo(100_000 * 1.03 ** 2, 6);
  });

  it("honours an income's own inflation start year", () => {
    const t = tree(
      [rule({ accountId: "a1", annualPercent: 0.05 })],
      [salary(100_000, { growthRate: 0.03, startYear: 2020, inflationStartYear: 2026 })],
    );
    expect(householdSalary(t, 2026)).toBe(100_000);
  });
});
