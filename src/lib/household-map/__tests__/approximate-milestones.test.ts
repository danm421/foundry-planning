import { describe, expect, it } from "vitest";
import { approximateMilestones } from "@/lib/household-map/approximate-milestones";
import type { MapPeople } from "@/lib/household-map/types";
import type { MapGoal } from "@/lib/household-map/goals";

const PEOPLE: MapPeople = {
  client: { firstName: "Cooper", birthYear: 1975, retirementYear: 2040, age: 51 },
  spouse: { firstName: "Dana", birthYear: 1977, retirementYear: 2042, age: 49 },
  children: [],
} as unknown as MapPeople;

function leGoal(owner: "client" | "spouse", year: number): MapGoal {
  return {
    id: `le-${owner}`,
    kind: "life_expectancy",
    title: "Life expectancy",
    year,
    side: owner,
    expenseId: null,
    lifeExpectancy: { owner, age: 95, assumed: false },
  } as unknown as MapGoal;
}

describe("approximateMilestones", () => {
  it("takes planEnd from the LATER of the two life-expectancy cards", () => {
    // Spouse outlives the client. planEnd must follow the spouse, not the client.
    const m = approximateMilestones(PEOPLE, [leGoal("client", 2070), leGoal("spouse", 2074)], 2026);
    expect(m.clientEnd).toBe(2070);
    expect(m.spouseEnd).toBe(2074);
    expect(m.planEnd).toBe(2074);
  });

  it("falls back to currentYear + 30 when there is no client life-expectancy card", () => {
    const m = approximateMilestones(PEOPLE, [], 2026);
    expect(m.clientEnd).toBe(2056);
    expect(m.planEnd).toBe(2056);
    expect(m.spouseEnd).toBeUndefined();
  });

  it("reads retirement years off the people, not the goals", () => {
    const m = approximateMilestones(PEOPLE, [], 2026);
    expect(m.clientRetirement).toBe(2040);
    expect(m.spouseRetirement).toBe(2042);
    expect(m.planStart).toBe(2026);
  });
});
