// Committed self-test of the golden-fixture eval harness's PURE parts: the
// manifest -> assertion mapping. This is the only part of task 19 that can be
// honestly green today (no fixtures are checked in yet, see fixtures/manifest.ts's
// header comment) - it never calls a model, only compares hand-built
// PlanningDecisions objects against `FixtureCase["expect"]` blocks. Runs under
// plain `npm test`, unlike golden.eval.ts. Mirrors
// `src/domain/forge/evals/__tests__/assertions.test.ts`, which does the same
// thing for the Forge eval lane.
import { describe, it, expect } from "vitest";
import { checkFixtureCase, formatFailures } from "./golden-assertions";
import type { PlanningDecisions } from "../types";
import { FIXTURES } from "./fixtures/manifest";

function d<T>(value: T, reason = "because the document says so") {
  return { value, provenance: "document" as const, reason };
}

const EMPTY: PlanningDecisions = {
  version: 1,
  assumptions: {},
  savings: [],
  socialSecurity: [],
  goals: [],
  incomeTiming: [],
  questions: [],
  notes: [],
};

function savingsRow(
  accountName: string,
  owner: "client" | "spouse" = "client",
): PlanningDecisions["savings"][number] {
  return { accountName, owner };
}

function ssRow(
  owner: "client" | "spouse",
  basis: "stated_fra_amount" | "estimated_from_income",
  piaMonthly: number,
): PlanningDecisions["socialSecurity"][number] {
  return { owner, piaMonthly: d(piaMonthly), claimingAge: d(67), basis };
}

function goalRow(name: string): PlanningDecisions["goals"][number] {
  return {
    kind: "one_time",
    name: d(name),
    annualAmount: d(1000),
    startYear: d(2030),
    endYear: d(2031),
    dedicatedAccountNames: [],
  };
}

describe("checkFixtureCase - assumptions", () => {
  it("passes when every expected assumption matches", () => {
    const decisions: PlanningDecisions = {
      ...EMPTY,
      assumptions: { retirementAge: d(64), inflationRate: d(0.03) },
    };
    expect(checkFixtureCase(decisions, { retirementAge: 64, inflationRate: 0.03 })).toEqual([]);
  });

  it("fails when a numeric assumption doesn't match", () => {
    const decisions: PlanningDecisions = { ...EMPTY, assumptions: { retirementAge: d(62) } };
    expect(checkFixtureCase(decisions, { retirementAge: 64 })).toEqual([
      { field: "assumptions.retirementAge", expected: 64, actual: 62 },
    ]);
  });

  it("FAILS (never passes) when an expected assumption is entirely absent from the decisions", () => {
    // The vacuity trap this guards against: `undefined === undefined` must
    // never read as a match.
    const failures = checkFixtureCase(EMPTY, { spouseLifeExpectancy: 95 });
    expect(failures).toEqual([
      { field: "assumptions.spouseLifeExpectancy", expected: 95, actual: undefined },
    ]);
  });

  it("ignores assumption fields the manifest case doesn't assert", () => {
    const decisions: PlanningDecisions = { ...EMPTY, assumptions: { retirementAge: d(999) } };
    expect(checkFixtureCase(decisions, {})).toEqual([]);
  });
});

describe("checkFixtureCase - savings", () => {
  it("fails when there are fewer savings decisions than minSavings", () => {
    const decisions: PlanningDecisions = { ...EMPTY, savings: [savingsRow("A")] };
    expect(checkFixtureCase(decisions, { minSavings: 3 })).toEqual([
      { field: "savings.length", expected: ">= 3", actual: 1 },
    ]);
  });

  it("fails when a named account's annualPercent doesn't match", () => {
    const decisions: PlanningDecisions = {
      ...EMPTY,
      savings: [{ ...savingsRow("Zach 401(k)"), annualPercent: d(0.05) }],
    };
    expect(checkFixtureCase(decisions, { savingsPercentByAccount: { "Zach 401(k)": 0.1 } })).toEqual([
      { field: "savings[accountName=Zach 401(k)].annualPercent", expected: 0.1, actual: 0.05 },
    ]);
  });

  it("fails when the named account is missing entirely", () => {
    const failures = checkFixtureCase(EMPTY, { savingsPercentByAccount: { "Zach 401(k)": 0.1 } });
    expect(failures).toEqual([
      { field: "savings[accountName=Zach 401(k)].annualPercent", expected: 0.1, actual: undefined },
    ]);
  });

  it("fails on a wrong employer match pct or cap independently", () => {
    const decisions: PlanningDecisions = {
      ...EMPTY,
      savings: [{ ...savingsRow("Barclays 401K"), employerMatchPct: d(0.25), employerMatchCap: d(0.06) }],
    };
    expect(checkFixtureCase(decisions, { savingsMatchByAccount: { "Barclays 401K": [0.5, 0.06] } })).toEqual([
      { field: "savings[accountName=Barclays 401K].employerMatchPct", expected: 0.5, actual: 0.25 },
    ]);
  });
});

describe("checkFixtureCase - social security", () => {
  it("fails on a wrong basis", () => {
    // `ssBasisByOwner` is a full `Record<"client"|"spouse", string>` per the
    // manifest's own interface, so both owners must be supplied whenever the
    // field is set - the spouse row here matches so only the client mismatch
    // shows up in the result.
    const decisions: PlanningDecisions = {
      ...EMPTY,
      socialSecurity: [
        ssRow("client", "stated_fra_amount", 2500),
        ssRow("spouse", "estimated_from_income", 1800),
      ],
    };
    expect(
      checkFixtureCase(decisions, {
        ssBasisByOwner: { client: "estimated_from_income", spouse: "estimated_from_income" },
      }),
    ).toEqual([
      {
        field: "socialSecurity[owner=client].basis",
        expected: "estimated_from_income",
        actual: "stated_fra_amount",
      },
    ]);
  });

  it("fails when piaMonthly is zero even though the basis matches", () => {
    const decisions: PlanningDecisions = {
      ...EMPTY,
      socialSecurity: [
        ssRow("client", "estimated_from_income", 0),
        ssRow("spouse", "estimated_from_income", 1800),
      ],
    };
    expect(
      checkFixtureCase(decisions, {
        ssBasisByOwner: { client: "estimated_from_income", spouse: "estimated_from_income" },
      }),
    ).toEqual([{ field: "socialSecurity[owner=client].piaMonthly", expected: "non-zero", actual: 0 }]);
  });

  it("fails once per owner missing from socialSecurity entirely", () => {
    const failures = checkFixtureCase(EMPTY, {
      ssBasisByOwner: { client: "estimated_from_income", spouse: "stated_fra_amount" },
    });
    expect(failures).toEqual([
      { field: "socialSecurity[owner=client]", expected: "estimated_from_income", actual: undefined },
      { field: "socialSecurity[owner=spouse]", expected: "stated_fra_amount", actual: undefined },
    ]);
  });
});

describe("checkFixtureCase - reasonContains", () => {
  it("passes when some decision's reason contains the substring", () => {
    const decisions: PlanningDecisions = {
      ...EMPTY,
      assumptions: { spouseRetirementAge: d(60, "Spouse retires at 60 per the narrative.") },
    };
    expect(checkFixtureCase(decisions, { reasonContains: ["60"] })).toEqual([]);
  });

  it("fails when no reason anywhere contains the substring", () => {
    const decisions: PlanningDecisions = {
      ...EMPTY,
      assumptions: { spouseRetirementAge: d(60, "Spouse retires early.") },
    };
    const failures = checkFixtureCase(decisions, { reasonContains: ["60"] });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ field: "reason", expected: 'contains "60"' });
  });
});

describe("checkFixtureCase - goals", () => {
  it("fails when there are fewer goals than minGoals", () => {
    expect(checkFixtureCase(EMPTY, { minGoals: 2 })).toEqual([
      { field: "goals.length", expected: ">= 2", actual: 0 },
    ]);
  });

  it("passes when goal count meets minGoals", () => {
    const decisions: PlanningDecisions = { ...EMPTY, goals: [goalRow("A"), goalRow("B")] };
    expect(checkFixtureCase(decisions, { minGoals: 2 })).toEqual([]);
  });
});

describe("checkFixtureCase - multiple failures accumulate, not short-circuit", () => {
  it("reports every mismatch, not just the first", () => {
    const decisions: PlanningDecisions = { ...EMPTY, assumptions: { retirementAge: d(1) } };
    const failures = checkFixtureCase(decisions, { retirementAge: 64, minGoals: 2 });
    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.field)).toEqual(["assumptions.retirementAge", "goals.length"]);
  });
});

describe("formatFailures", () => {
  it("names the fixture, field, expected, and actual for every failure", () => {
    const text = formatFailures("emoney-facts-full", [
      { field: "assumptions.retirementAge", expected: 64, actual: 62 },
    ]);
    expect(text).toContain("emoney-facts-full");
    expect(text).toContain("assumptions.retirementAge");
    expect(text).toContain("64");
    expect(text).toContain("62");
  });
});

describe("checkFixtureCase - against the real manifest", () => {
  const fixture = FIXTURES.find((f) => f.slug === "emoney-facts-full");
  if (!fixture) throw new Error("manifest.ts no longer has an emoney-facts-full case");

  function buildMatchingDecisions(): PlanningDecisions {
    return {
      version: 1,
      assumptions: {
        retirementAge: d(64),
        spouseRetirementAge: d(60),
        lifeExpectancy: d(95),
        spouseLifeExpectancy: d(95),
        inflationRate: d(0.03),
      },
      savings: [
        { ...savingsRow("Zach 401(k)"), annualPercent: d(0.1), employerMatchPct: d(1), employerMatchCap: d(0.04) },
        {
          ...savingsRow("Mariah 403(b)", "spouse"),
          annualPercent: d(0.07),
          employerMatchPct: d(1),
          employerMatchCap: d(0.03),
        },
        savingsRow("Emergency Fund"),
      ],
      socialSecurity: [
        ssRow("client", "estimated_from_income", 2500),
        ssRow("spouse", "estimated_from_income", 1800),
      ],
      goals: [goalRow("A"), goalRow("B"), goalRow("C"), goalRow("D")],
      incomeTiming: [],
      questions: [],
      notes: [],
    };
  }

  it("passes a decisions object that matches every field in the manifest's emoney-facts-full case", () => {
    expect(checkFixtureCase(buildMatchingDecisions(), fixture.expect)).toEqual([]);
  });

  it("fails on exactly the field that regresses", () => {
    const decisions = buildMatchingDecisions();
    decisions.assumptions.spouseRetirementAge = d(61);
    const failures = checkFixtureCase(decisions, fixture.expect);
    expect(failures).toEqual([{ field: "assumptions.spouseRetirementAge", expected: 60, actual: 61 }]);
  });
});
