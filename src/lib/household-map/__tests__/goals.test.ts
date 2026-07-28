// src/lib/household-map/__tests__/goals.test.ts
import { describe, it, expect } from "vitest";
import { buildMapGoals } from "../goals";
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
    spouseFirstName: "Amy",
    spouseRetirementAge: 65,
    spouseLifeExpectancy: 90,
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
  it("always emits the three life milestones for a married household", () => {
    expect(ids(base)).toEqual([
      "milestone:client_retirement",
      "milestone:spouse_retirement",
      "milestone:plan_end",
    ]);
  });

  it("omits the spouse milestone when unmarried", () => {
    const solo: BuildMapGoalsInput = {
      ...base,
      milestones: { ...milestones, spouseRetirement: undefined, spouseEnd: undefined },
      client: { ...base.client, spouseFirstName: null, spouseRetirementAge: null, spouseLifeExpectancy: null },
    };
    expect(ids(solo)).toEqual(["milestone:client_retirement", "milestone:plan_end"]);
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

  it("puts plan end on the side of whoever lives longest", () => {
    const goals = buildMapGoals(base);
    // clientEnd 2064 > spouseEnd 2062, so plan end is the client's.
    const planEnd = goals.find((g) => g.id === "milestone:plan_end");
    expect(planEnd?.side).toBe("client");
    expect(planEnd?.year).toBe(2064);
  });

  it("puts plan end on the spouse's side when the spouse outlives the client", () => {
    const goals = buildMapGoals({
      ...base,
      milestones: { ...milestones, clientEnd: 2058, spouseEnd: 2066 },
    });
    const planEnd = goals.find((g) => g.id === "milestone:plan_end");
    expect(planEnd?.side).toBe("spouse");
    expect(planEnd?.year).toBe(2066);
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

  it("omits the age from plan-end detail when the outliving spouse's life expectancy is unknown", () => {
    const goals = buildMapGoals({
      ...base,
      milestones: { ...milestones, clientEnd: 2058, spouseEnd: 2066 },
      client: { ...base.client, spouseLifeExpectancy: null },
    });
    const planEnd = goals.find((g) => g.id === "milestone:plan_end");
    expect(planEnd?.detail).toBe(null);
  });
});
