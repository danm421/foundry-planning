import { describe, it, expect } from "vitest";
import {
  resolveInheritedRule,
  inheritedRmdForYear,
  inheritedPayoutForYear,
  inheritedPayoutWindowFor,
  describeInheritedPayoutWindow,
  inheritedPlannedPayoutLabel,
  defaultInheritedPayoutWindow,
  type InheritedIraInput,
  type InheritedPayoutWindow,
} from "../inherited-ira";
import type { Account } from "../types";

// Karen (spec 2026-10-03): owner born 1930 died 2026 (had started RMDs); heir
// born 1954 → 10-year rule with yearly RMDs, deadline 2036. Heir divisor is
// 16.4 − (Y − 2027), which beats the owner's every year.
const KAREN: InheritedIraInput = { deathYear: 2026, ownerBirthYear: 1930, heirBirthYear: 1954, heirDisabled: false, isRoth: false };
// The 2026-09-28 spec's examples 2, 4 (Roth) and 7 (older heir, pre-SECURE stretch).
const EX2: InheritedIraInput = { deathYear: 2022, ownerBirthYear: 1945, heirBirthYear: 1975, heirDisabled: false, isRoth: false };
const EX4_ROTH: InheritedIraInput = { ...EX2, isRoth: true };
const EX7: InheritedIraInput = { deathYear: 2015, ownerBirthYear: 1940, heirBirthYear: 1935, heirDisabled: false, isRoth: false };

const W = (fromYear: number, throughYear: number): InheritedPayoutWindow => ({ fromYear, throughYear });

function pay(input: InheritedIraInput, window: InheritedPayoutWindow | null, year: number, balance: number) {
  return inheritedPayoutForYear({
    input, rule: resolveInheritedRule(input), year,
    priorYearEndBalance: balance, currentBalance: balance, window,
  });
}

describe("inheritedPayoutForYear — worked examples (spec 2026-10-03)", () => {
  it("1. a window year pays the even share when it beats the minimum", () => {
    const r = pay(KAREN, W(2031, 2036), 2031, 300_000);
    expect(r.minimum.amount).toBeCloseTo(300_000 / 12.4, 6);
    expect(r.total).toBeCloseTo(50_000, 6);
    expect(r.extra).toBeCloseTo(50_000 - 300_000 / 12.4, 6);
  });
  it("2. the last window year empties the account, even before the deadline", () => {
    const r = pay(KAREN, W(2029, 2033), 2033, 62_000);
    expect(r.minimum.amount).toBeCloseTo(62_000 / 10.4, 6);
    expect(r.total).toBe(62_000);
    expect(pay(KAREN, W(2029, 2033), 2034, 0).total).toBe(0);
  });
  it("3. before the window only the minimum comes out", () => {
    const r = pay(KAREN, W(2031, 2036), 2029, 300_000);
    expect(r.total).toBeCloseTo(300_000 / 14.4, 6);
    expect(r.extra).toBe(0);
  });
  it("4. the minimum is the floor when it beats the even share", () => {
    const r = pay(EX7, W(2026, 2035), 2026, 100_000);
    expect(r.minimum.amount).toBeCloseTo(100_000 / 3.8, 6);
    expect(r.total).toBeCloseTo(26_315.79, 2);
    expect(r.extra).toBe(0);
  });
  it("5. a one-year window takes the whole balance that year", () => {
    expect(pay(KAREN, W(2030, 2030), 2030, 250_000).total).toBe(250_000);
  });
  it("6. a window past the 10-year deadline is clamped to the deadline", () => {
    // ÷ 6 (2031–2036), not ÷ 10 (2031–2040).
    expect(pay(KAREN, W(2031, 2040), 2031, 600_000).total).toBeCloseTo(100_000, 6);
    const last = pay(KAREN, W(2031, 2040), 2036, 100_000);
    expect(last.total).toBe(100_000);
    expect(last.minimum.fullPayout).toBe(true);
  });
  it("7. an inherited Roth with no yearly RMDs pays the even share, then the deadline sweep", () => {
    const y2030 = pay(EX4_ROTH, W(2030, 2032), 2030, 300_000);
    expect(y2030.minimum.amount).toBe(0);
    expect(y2030.total).toBeCloseTo(100_000, 6);
    expect(y2030.extra).toBeCloseTo(100_000, 6);
    expect(pay(EX4_ROTH, W(2030, 2032), 2031, 200_000).total).toBeCloseTo(100_000, 6);
    const y2032 = pay(EX4_ROTH, W(2030, 2032), 2032, 100_000);
    expect(y2032.total).toBe(100_000);
    expect(y2032.extra).toBe(0);
  });
  it("8. no window: exactly the minimum, extra 0", () => {
    const cases: [InheritedIraInput, number, number][] = [[EX2, 2026, 400_000], [EX7, 2026, 100_000], [KAREN, 2036, 90_000]];
    for (const [input, year, bal] of cases) {
      const min = inheritedRmdForYear({ input, rule: resolveInheritedRule(input), year, priorYearEndBalance: bal, currentBalance: bal });
      const r = pay(input, null, year, bal);
      expect(r.minimum).toEqual(min);
      expect(r.total).toBe(min.amount);
      expect(r.extra).toBe(0);
    }
  });
});

describe("inheritedPayoutForYear edges", () => {
  it("takes nothing in or before the year of death, even inside the window", () => {
    expect(pay(KAREN, W(2026, 2030), 2026, 100_000).total).toBe(0);
  });
  it("a window that ended before this year adds nothing", () => {
    expect(pay(KAREN, W(2027, 2028), 2031, 300_000).extra).toBe(0);
    // The year right after: an unguarded share would divide by zero.
    expect(pay(KAREN, W(2027, 2030), 2031, 300_000).extra).toBe(0);
  });
  it("a window that started before this year counts the years left from this year", () => {
    // 2031–2036 is 6 years left, whatever year the window opened.
    expect(pay(KAREN, W(2027, 2036), 2031, 300_000).total).toBeCloseTo(50_000, 6);
  });
  it("never pays more than the current balance", () => {
    const r = inheritedPayoutForYear({
      input: KAREN, rule: resolveInheritedRule(KAREN), year: 2031,
      priorYearEndBalance: 900_000, currentBalance: 10_000, window: W(2031, 2036),
    });
    expect(r.total).toBe(10_000);
  });
  it("pays nothing from an empty account", () => {
    expect(pay(KAREN, W(2031, 2036), 2031, 0).total).toBe(0);
  });
});

describe("inheritedPayoutWindowFor", () => {
  const base: Account = {
    id: "ira-inh", name: "Inherited IRA", category: "retirement", subType: "traditional_ira",
    titlingType: "jtwros", value: 100_000, basis: 0, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    inheritedDeathYear: 2026, inheritedOwnerBirthYear: 1930,
    inheritedPayoutFromYear: 2031, inheritedPayoutThroughYear: 2036,
  };
  it("reads the window off an inherited IRA", () => {
    expect(inheritedPayoutWindowFor(base)).toEqual({ fromYear: 2031, throughYear: 2036 });
  });
  it("is null with no window, half a window, or a reversed one", () => {
    expect(inheritedPayoutWindowFor({ ...base, inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null })).toBeNull();
    expect(inheritedPayoutWindowFor({ ...base, inheritedPayoutThroughYear: null })).toBeNull();
    expect(inheritedPayoutWindowFor({ ...base, inheritedPayoutFromYear: 2037 })).toBeNull();
  });
  it("is null when a year is not a whole number (a non-form writer)", () => {
    const notAYear = [Number.NaN, 2031.5, "" as unknown as number, "2031" as unknown as number];
    for (const bad of notAYear) {
      expect(inheritedPayoutWindowFor({ ...base, inheritedPayoutFromYear: bad })).toBeNull();
      expect(inheritedPayoutWindowFor({ ...base, inheritedPayoutThroughYear: bad })).toBeNull();
    }
  });
  it("is null on an account that isn't inherited", () => {
    expect(inheritedPayoutWindowFor({ ...base, inheritedDeathYear: null })).toBeNull();
    expect(inheritedPayoutWindowFor({ ...base, subType: "401k" })).toBeNull();
  });
});

describe("describeInheritedPayoutWindow", () => {
  it("names the window and the year the account is empty", () => {
    expect(describeInheritedPayoutWindow(W(2031, 2036), 2036)).toBe(
      "Each year from 2031 through 2036 pays the larger of the minimum and an even share of what's left. The account is empty after 2036.",
    );
  });
  it("quotes the deadline, not a later typed year", () => {
    expect(describeInheritedPayoutWindow(W(2031, 2040), 2036)).toContain("through 2036");
  });
  it("keeps the typed year on a stretch account (no deadline)", () => {
    expect(describeInheritedPayoutWindow(W(2027, 2045), null)).toContain("The account is empty after 2045.");
  });
  it("says so for a one-year window", () => {
    expect(describeInheritedPayoutWindow(W(2030, 2030), 2036)).toBe("The whole balance comes out in 2030.");
  });
});

describe("inheritedPlannedPayoutLabel", () => {
  it("names the window, clamped to the deadline", () => {
    expect(inheritedPlannedPayoutLabel(W(2031, 2036), 2036)).toBe("Inherited IRA planned payout (spread evenly 2031–2036)");
    expect(inheritedPlannedPayoutLabel(W(2031, 2040), 2036)).toBe("Inherited IRA planned payout (spread evenly 2031–2036)");
    expect(inheritedPlannedPayoutLabel(W(2030, 2030), 2036)).toBe("Inherited IRA planned payout (all in 2030)");
  });
});

describe("defaultInheritedPayoutWindow", () => {
  it("starts at the later of the plan's first year and the year after death, and ends at the deadline", () => {
    expect(defaultInheritedPayoutWindow(2026, 2036, 2026)).toEqual({ fromYear: 2027, throughYear: 2036 });
    expect(defaultInheritedPayoutWindow(2022, 2032, 2026)).toEqual({ fromYear: 2026, throughYear: 2032 });
  });
  it("leaves the last year blank on a stretch account", () => {
    expect(defaultInheritedPayoutWindow(2021, null, 2026)).toEqual({ fromYear: 2026, throughYear: null });
  });
});
