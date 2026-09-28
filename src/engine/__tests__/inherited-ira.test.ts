import { describe, it, expect } from "vitest";
import {
  singleLifeExpectancy,
  ownerHadStartedRmds,
  resolveInheritedRule,
  inheritedRmdForYear,
  describeInheritedRule,
  inheritedRmdLabel,
  isInheritedIra,
  inheritedIraInputFor,
  type InheritedIraInput,
} from "../inherited-ira";
import type { Account } from "../types";

function run(input: InheritedIraInput, year: number, prior: number, current = prior) {
  const rule = resolveInheritedRule(input);
  return {
    rule,
    r: inheritedRmdForYear({ input, rule, year, priorYearEndBalance: prior, currentBalance: current }),
  };
}

const EX1: InheritedIraInput = { deathYear: 2015, ownerBirthYear: 1940, heirBirthYear: 1965, heirDisabled: false, isRoth: false };
const EX2: InheritedIraInput = { deathYear: 2022, ownerBirthYear: 1945, heirBirthYear: 1975, heirDisabled: false, isRoth: false };
const EX3: InheritedIraInput = { deathYear: 2024, ownerBirthYear: 1960, heirBirthYear: 1990, heirDisabled: false, isRoth: false };
const EX4: InheritedIraInput = { ...EX2, isRoth: true };
const EX5: InheritedIraInput = { deathYear: 2021, ownerBirthYear: 1955, heirBirthYear: 1958, heirDisabled: false, isRoth: false };
const EX6: InheritedIraInput = { ...EX3, heirDisabled: true };
const EX7: InheritedIraInput = { deathYear: 2015, ownerBirthYear: 1940, heirBirthYear: 1935, heirDisabled: false, isRoth: false };

describe("singleLifeExpectancy", () => {
  it("matches Treas. Reg. §1.401(a)(9)-9(b) Table 1 spot checks", () => {
    expect(singleLifeExpectancy(0)).toBe(84.6);
    expect(singleLifeExpectancy(35)).toBe(50.5);
    expect(singleLifeExpectancy(48)).toBe(38.1);
    expect(singleLifeExpectancy(51)).toBe(35.3);
    expect(singleLifeExpectancy(64)).toBe(23.7);
    expect(singleLifeExpectancy(75)).toBe(14.8);
    expect(singleLifeExpectancy(77)).toBe(13.3);
    expect(singleLifeExpectancy(81)).toBe(10.5);
    expect(singleLifeExpectancy(119)).toBe(1.1);
    expect(singleLifeExpectancy(120)).toBe(1.0);
  });
  it("clamps ages outside the table", () => {
    expect(singleLifeExpectancy(-3)).toBe(84.6);
    expect(singleLifeExpectancy(130)).toBe(1.0);
  });
  it("never increases with age", () => {
    for (let a = 1; a <= 120; a++) {
      expect(singleLifeExpectancy(a)).toBeLessThanOrEqual(singleLifeExpectancy(a - 1));
    }
  });
});

describe("ownerHadStartedRmds", () => {
  it.each([
    [1940, 2015, true],  // 70½ placed at 2011
    [1945, 2022, true],  // 70½ placed at 2016
    [1949, 2020, false], // 70½ placed at 2020 — a death that year counts as before the RBD
    [1949, 2021, true],
    [1950, 2022, false], // 72 reached 2022
    [1950, 2023, true],
    [1955, 2021, false], // 73 reached 2028
    [1959, 2033, true],  // 73 reached 2032
    [1960, 2024, false], // 75 reached 2035
    [1960, 2036, true],
  ])("owner born %i, died %i → %s", (ownerBirthYear, deathYear, expected) => {
    expect(ownerHadStartedRmds(ownerBirthYear, deathYear, false)).toBe(expected);
  });
  it("is always false for a Roth IRA", () => {
    expect(ownerHadStartedRmds(1940, 2015, true)).toBe(false);
  });
});

describe("worked examples (spec)", () => {
  it("1. pre-SECURE stretch, owner had started: the heir's life expectancy wins", () => {
    const { rule, r } = run(EX1, 2026, 500_000);
    expect(rule).toEqual({
      regime: "pre_secure", method: "stretch", stretchReason: "pre_secure",
      ownerStartedRmds: true, finalYear: null, yearlyRmds: true,
    });
    expect(r.divisor).toBeCloseTo(25.3, 10);
    expect(r.amount).toBeCloseTo(19_762.85, 2);
    expect(r.fullPayout).toBe(false);
  });

  it("2. 10-year rule, owner had started: yearly RMDs, then the full balance in D+10", () => {
    const { rule, r } = run(EX2, 2026, 400_000);
    expect(rule).toEqual({
      regime: "secure", method: "ten_year", stretchReason: null,
      ownerStartedRmds: true, finalYear: 2032, yearlyRmds: true,
    });
    expect(r.divisor).toBeCloseTo(35.1, 10);
    expect(r.amount).toBeCloseTo(11_396.01, 2);
    expect(run(EX2, 2031, 400_000).r.fullPayout).toBe(false);
    expect(run(EX2, 2032, 400_000, 437_000).r).toEqual({ amount: 437_000, divisor: null, fullPayout: true });
  });

  it("2b. 10-year yearly RMDs are waived 2021–2024 and resume in 2025", () => {
    const input: InheritedIraInput = { deathYear: 2020, ownerBirthYear: 1940, heirBirthYear: 1975, heirDisabled: false, isRoth: false };
    for (const y of [2021, 2022, 2023, 2024]) expect(run(input, y, 100_000).r.amount).toBe(0);
    expect(run(input, 2025, 100_000).r.amount).toBeGreaterThan(0);
  });

  it("3. 10-year rule, owner had NOT started: nothing until the full payout", () => {
    for (let y = 2025; y <= 2033; y++) expect(run(EX3, y, 250_000).r.amount).toBe(0);
    expect(run(EX3, 2034, 250_000, 300_000).r).toEqual({ amount: 300_000, divisor: null, fullPayout: true });
  });

  it("4. inherited Roth, 10-year rule: no yearly RMDs even though the owner was past RMD age", () => {
    const { rule, r } = run(EX4, 2026, 400_000);
    expect(rule).toMatchObject({ method: "ten_year", ownerStartedRmds: false, yearlyRmds: false, finalYear: 2032 });
    expect(r.amount).toBe(0);
    expect(run(EX4, 2032, 400_000).r.fullPayout).toBe(true);
  });

  it("5. stretch by age gap (heir ≤ 10 years younger), owner died before the RBD", () => {
    const { rule, r } = run(EX5, 2026, 300_000);
    expect(rule).toMatchObject({ regime: "secure", method: "stretch", stretchReason: "age_gap", ownerStartedRmds: false, finalYear: null });
    expect(r.divisor).toBeCloseTo(19.7, 10);
    expect(r.amount).toBeCloseTo(15_228.43, 2);
  });

  it("5b. exactly 10 years younger still stretches; 11 years does not", () => {
    expect(resolveInheritedRule({ ...EX5, heirBirthYear: 1965 }).method).toBe("stretch");
    expect(resolveInheritedRule({ ...EX5, heirBirthYear: 1966 }).method).toBe("ten_year");
  });

  it("5c. an OLDER heir still stretches, on the heir's life expectancy alone when the owner had not started", () => {
    // Owner 1955 died 2021 (73 reached 2028 → not started). Heir 1950 is 5 years older.
    // Heir LE = SLT[72] 17.2 − 4 = 13.2; the owner's 22.0 − 5 = 17.0 must NOT be used.
    const input: InheritedIraInput = { deathYear: 2021, ownerBirthYear: 1955, heirBirthYear: 1950, heirDisabled: false, isRoth: false };
    const { rule, r } = run(input, 2026, 100_000);
    expect(rule).toMatchObject({ regime: "secure", method: "stretch", stretchReason: "age_gap", ownerStartedRmds: false });
    expect(r.divisor).toBeCloseTo(13.2, 10);
  });

  it("5d. the 2021–2024 waiver is for the 10-year rule only — a stretch year inside it still pays", () => {
    const r = run(EX5, 2022, 100_000).r;
    expect(r.divisor).toBeCloseTo(23.7, 10);
    expect(r.amount).toBeCloseTo(4_219.41, 2);
  });

  it("6. stretch by disability", () => {
    const { rule, r } = run(EX6, 2026, 100_000);
    expect(rule).toMatchObject({ method: "stretch", stretchReason: "disabled" });
    expect(r.divisor).toBeCloseTo(49.5, 10);
  });

  it("7. heir older than the owner: 'greater of' picks the owner's remaining life expectancy", () => {
    const { r } = run(EX7, 2026, 100_000);
    expect(r.divisor).toBeCloseTo(3.8, 10);
    expect(r.amount).toBeCloseTo(26_315.79, 2);
    expect(r.fullPayout).toBe(false);
  });
});

describe("inheritedRmdForYear edges", () => {
  it("pays out the whole balance once the divisor reaches 1", () => {
    // EX7: owner LE = 14.8 − (Y − 2015) → 1.8 in 2028, 0.8 in 2029; heir LE is lower.
    expect(run(EX7, 2028, 50_000).r.fullPayout).toBe(false);
    const r2029 = run(EX7, 2029, 50_000, 55_000).r;
    expect(r2029.amount).toBe(55_000);
    expect(r2029.divisor).toBeCloseTo(0.8, 10);
    expect(r2029.fullPayout).toBe(true);
  });
  it("takes nothing in or before the year of death", () => {
    const input: InheritedIraInput = { ...EX2, deathYear: 2026 };
    expect(run(input, 2026, 400_000).r.amount).toBe(0);
    expect(run(input, 2027, 400_000).r.amount).toBeGreaterThan(0);
  });
  it("takes nothing from an empty account", () => {
    expect(run(EX1, 2026, 0, 0).r.amount).toBe(0);
    // A $0 account in its 10-year final year is not a "final payout".
    expect(run(EX2, 2032, 0, 0).r).toEqual({ amount: 0, divisor: null, fullPayout: false });
  });
  it("never takes more than the current balance", () => {
    expect(run(EX7, 2026, 100_000, 10_000).r.amount).toBe(10_000);
  });
});

describe("describeInheritedRule", () => {
  const say = (input: InheritedIraInput) => describeInheritedRule(input, resolveInheritedRule(input), 2026);
  it("10-year rule with yearly RMDs", () => {
    expect(say(EX2)).toContain("Dec 31, 2032");
    expect(say(EX2)).toContain("Yearly RMDs are also required");
  });
  it("10-year rule without yearly RMDs", () => {
    expect(say(EX3)).toContain("Dec 31, 2034");
    expect(say(EX3)).toContain("had not started RMDs");
  });
  it("inherited Roth", () => {
    expect(say(EX4)).toContain("Roth IRA owners never start RMDs");
    expect(say(EX4)).toContain("tax-free");
  });
  it("stretch by age gap quotes the divisor for the reference year", () => {
    expect(say(EX5)).toContain("no more than 10 years younger");
    expect(say(EX5)).toContain("Divisor 19.7 in 2026");
  });
  it("pre-SECURE stretch", () => {
    expect(say(EX1)).toContain("before 2020");
    expect(say(EX1)).toContain("Divisor 25.3 in 2026");
  });
});

describe("inheritedRmdLabel", () => {
  it("names the rule and the divisor", () => {
    expect(inheritedRmdLabel(resolveInheritedRule(EX1), run(EX1, 2026, 500_000).r)).toBe("Inherited IRA RMD (stretch, divisor 25.3)");
    expect(inheritedRmdLabel(resolveInheritedRule(EX2), run(EX2, 2026, 400_000).r)).toBe("Inherited IRA RMD (10-year rule, divisor 35.1)");
  });
  it("names the final payouts", () => {
    expect(inheritedRmdLabel(resolveInheritedRule(EX2), run(EX2, 2032, 1).r)).toBe("Inherited IRA RMD (10-year rule, final payout)");
    expect(inheritedRmdLabel(resolveInheritedRule(EX7), run(EX7, 2029, 1).r)).toBe("Inherited IRA RMD (life expectancy exhausted, final payout)");
  });
});

describe("isInheritedIra / inheritedIraInputFor", () => {
  const base: Account = {
    id: "ira-inh", name: "Inherited IRA", category: "retirement", subType: "traditional_ira",
    titlingType: "jtwros", value: 100_000, basis: 0, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945,
  };
  it("is true for a family-owned Traditional or Roth IRA with both years", () => {
    expect(isInheritedIra(base)).toBe(true);
    expect(isInheritedIra({ ...base, subType: "roth_ira" })).toBe(true);
  });
  it("is false for other sub-types, missing years, or entity ownership", () => {
    expect(isInheritedIra({ ...base, subType: "401k" })).toBe(false);
    expect(isInheritedIra({ ...base, inheritedDeathYear: null })).toBe(false);
    expect(isInheritedIra({ ...base, inheritedOwnerBirthYear: undefined })).toBe(false);
    expect(isInheritedIra({ ...base, owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }] })).toBe(false);
  });
  it("builds the rule input from the account and the heir's birth year", () => {
    expect(inheritedIraInputFor(base, 1975)).toEqual({
      deathYear: 2022, ownerBirthYear: 1945, heirBirthYear: 1975, heirDisabled: false, isRoth: false,
    });
    expect(inheritedIraInputFor({ ...base, subType: "roth_ira", inheritedHeirDisabled: true }, 1975))
      .toMatchObject({ heirDisabled: true, isRoth: true });
    expect(inheritedIraInputFor({ ...base, inheritedDeathYear: null }, 1975)).toBeNull();
  });
});
