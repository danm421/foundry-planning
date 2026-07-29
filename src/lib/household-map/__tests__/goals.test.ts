// src/lib/household-map/__tests__/goals.test.ts
import { describe, it, expect } from "vitest";
import { ASSUMED_LIFE_EXPECTANCY, buildMapGoals } from "../goals";
import type { BuildMapGoalsInput } from "../goals";

const milestones = {
  planStart: 2026,
  planEnd: 2064,
  clientRetirement: 2037,
  clientEnd: 2064,
  spouseRetirement: 2039,
  spouseEnd: 2062,
};

const base: BuildMapGoalsInput = {
  expenses: [],
  milestones,
  client: {
    firstName: "Dan",
    retirementAge: 65,
    lifeExpectancy: 92,
    // Dan 1972 + 92 -> dies 2064. Amy 1974 + 90 -> dies 2064 too, but the two
    // are computed independently now, so a test that moves one must not move
    // the other.
    birthYear: 1972,
    spouseFirstName: "Amy",
    spouseRetirementAge: 65,
    spouseLifeExpectancy: 90,
    spouseBirthYear: 1974,
  },
  familyMemberNamesById: new Map([["fm-kelly", "Kelly"]]),
};

const expense = (over: Partial<BuildMapGoalsInput["expenses"][number]> = {}) => ({
  id: "exp-1",
  type: "other" as const,
  name: "Kitchen Remodel",
  annualAmount: 60000,
  startYear: 2033,
  endYear: 2033,
  startYearRef: null,
  endYearRef: null,
  isGoal: false,
  forFamilyMemberId: null,
  institutionName: null,
  ...over,
});

function ids(input: BuildMapGoalsInput) {
  return buildMapGoals(input).map((g) => g.id);
}

describe("buildMapGoals", () => {
  it("emits FOUR life milestones for a married household — a life expectancy for EACH spouse", () => {
    expect(ids(base)).toEqual([
      "milestone:client_retirement",
      "milestone:spouse_retirement",
      "milestone:client_life_expectancy",
      "milestone:spouse_life_expectancy",
    ]);
  });

  it("omits the spouse milestones when unmarried", () => {
    const solo: BuildMapGoalsInput = {
      ...base,
      milestones: { ...milestones, spouseRetirement: undefined, spouseEnd: undefined },
      client: {
        ...base.client,
        spouseFirstName: null,
        spouseRetirementAge: null,
        spouseLifeExpectancy: null,
        spouseBirthYear: null,
      },
    };
    expect(ids(solo)).toEqual([
      "milestone:client_retirement",
      "milestone:client_life_expectancy",
    ]);
  });

  it("includes an expense flagged isGoal", () => {
    const r = ids({ ...base, expenses: [expense({ isGoal: true })] });
    expect(r).toContain("expense:exp-1");
  });

  it("excludes an unflagged non-education expense", () => {
    const r = ids({ ...base, expenses: [expense({ isGoal: false })] });
    expect(r).not.toContain("expense:exp-1");
  });

  it("includes an education expense even when the flag is false", () => {
    const r = ids({
      ...base,
      expenses: [expense({ id: "exp-edu", type: "education", isGoal: false })],
    });
    expect(r).toContain("expense:exp-edu");
  });

  it("resolves a milestone-anchored start year rather than using the stored year", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ isGoal: true, startYear: 1999, startYearRef: "client_retirement" }),
      ],
    });
    expect(goals.find((g) => g.id === "expense:exp-1")?.year).toBe(2037);
  });

  it("sorts by resolved year ascending", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ id: "late", isGoal: true, startYear: 2050, endYear: 2050 }),
        expense({ id: "early", isGoal: true, startYear: 2029, endYear: 2032, type: "education" }),
      ],
    });
    expect(goals.map((g) => g.year)).toEqual([...goals.map((g) => g.year)].sort((a, b) => a - b));
  });

  it("labels the beneficiary on an education goal", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ id: "exp-edu", type: "education", forFamilyMemberId: "fm-kelly" }),
      ],
    });
    expect(goals.find((g) => g.id === "expense:exp-edu")?.forFamilyMemberName).toBe("Kelly");
  });

  // The bug this replaced: only ONE life-expectancy card was emitted, for the
  // LATER of the two deaths, so the first-to-die spouse never appeared on a
  // board whose entire point is a two-sided timeline.
  it("gives EACH spouse a life-expectancy card, on their own side of the spine", () => {
    const goals = buildMapGoals({
      ...base,
      // Dan dies 2064 (1972+92); Amy dies 2054 (1974+80) — she is first to die,
      // which is exactly the case the single-card version dropped.
      client: { ...base.client, spouseLifeExpectancy: 80 },
    });

    const client = goals.find((g) => g.id === "milestone:client_life_expectancy");
    expect(client).toMatchObject({ side: "client", year: 2064, title: "Dan's life expectancy" });

    const spouse = goals.find((g) => g.id === "milestone:spouse_life_expectancy");
    expect(spouse).toMatchObject({ side: "spouse", year: 2054, title: "Amy's life expectancy" });
  });

  // The second half of the same bug: the card's YEAR came from `milestones`
  // (both derived from the household-wide plan-end age) while its AGE came from
  // the person's real life expectancy, so the two disagreed. Nothing here may
  // read `milestones` — this asserts it by making those fields absurd.
  it("derives both years from birthYear + lifeExpectancy, never from milestones", () => {
    const goals = buildMapGoals({
      ...base,
      milestones: { ...milestones, clientEnd: 2099, spouseEnd: 2098, planEnd: 2097 },
    });

    expect(goals.find((g) => g.id === "milestone:client_life_expectancy")?.year).toBe(2064);
    expect(goals.find((g) => g.id === "milestone:spouse_life_expectancy")?.year).toBe(2064);
  });

  it("carries an editable payload whose age and year agree with the card", () => {
    const goals = buildMapGoals(base);

    expect(goals.find((g) => g.id === "milestone:client_life_expectancy")?.lifeExpectancy).toEqual({
      owner: "client",
      age: 92,
      year: 2064,
      assumed: false,
    });
    // Null everywhere else — its presence is what makes a card's age editable,
    // so a retirement milestone acquiring one would offer an editor that writes
    // the wrong column.
    expect(goals.find((g) => g.id === "milestone:client_retirement")?.lifeExpectancy).toBeNull();
  });

  it("drops a person's card when their birth year is unknown rather than inventing a year", () => {
    const goals = buildMapGoals({
      ...base,
      client: { ...base.client, spouseBirthYear: null },
    });
    expect(ids({ ...base, client: { ...base.client, spouseBirthYear: null } })).not.toContain(
      "milestone:spouse_life_expectancy",
    );
    expect(goals.find((g) => g.id === "milestone:client_life_expectancy")).toBeDefined();
  });

  it("classifies goal kinds from the expense type", () => {
    const goals = buildMapGoals({
      ...base,
      expenses: [
        expense({ id: "a", type: "education" }),
        expense({ id: "b", type: "other", isGoal: true }),
        expense({ id: "c", type: "living", isGoal: true }),
      ],
    });
    const byId = new Map(goals.map((g) => [g.id, g.kind]));
    expect(byId.get("expense:a")).toBe("education");
    expect(byId.get("expense:b")).toBe("purchase");
    expect(byId.get("expense:c")).toBe("household");
  });

  // A spouse with a DOB but no stored life expectancy is NOT hidden. The engine
  // is already projecting them to 95 (`spouseLifeExpectancy ?? 95` in
  // `computeFinalDeathYear`); showing that year flagged `assumed` is how an
  // advisor finds out. The old behaviour — dropping the age from the label —
  // hid the assumption instead.
  it("falls back to the engine's assumed 95 for a spouse with no stored life expectancy, and says so", () => {
    const goals = buildMapGoals({
      ...base,
      client: { ...base.client, spouseLifeExpectancy: null },
    });

    const spouse = goals.find((g) => g.id === "milestone:spouse_life_expectancy");
    expect(spouse?.year).toBe(1974 + ASSUMED_LIFE_EXPECTANCY);
    expect(spouse?.lifeExpectancy).toEqual({
      owner: "spouse",
      age: ASSUMED_LIFE_EXPECTANCY,
      year: 1974 + ASSUMED_LIFE_EXPECTANCY,
      assumed: true,
    });
    expect(spouse?.detail).toBe(`age ${ASSUMED_LIFE_EXPECTANCY} · assumed`);
  });

  // `buildClientMilestones` only populates the spouse milestones when a spouse
  // RETIREMENT AGE is set too. Keying the life-expectancy card off those hid it
  // for a spouse who has a DOB but has not retired on paper — two unrelated
  // facts.
  it("shows the spouse's life expectancy even with no spouse retirement age", () => {
    const goals = buildMapGoals({
      ...base,
      milestones: { ...milestones, spouseRetirement: undefined, spouseEnd: undefined },
      client: { ...base.client, spouseRetirementAge: null },
    });

    expect(goals.map((g) => g.id)).toContain("milestone:spouse_life_expectancy");
    expect(goals.find((g) => g.id === "milestone:spouse_life_expectancy")?.year).toBe(2064);
  });
});
