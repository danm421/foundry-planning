import { describe, it, expect } from "vitest";
import { currentPlanningYear, startsNextYear, planDataYear } from "@/lib/plan-year";

const OCT_2026 = new Date("2026-10-21T15:00:00Z");

describe("currentPlanningYear", () => {
  it("turns over at midnight US Eastern, not UTC", () => {
    expect(currentPlanningYear(new Date("2027-01-01T04:59:00Z"))).toBe(2026);
    expect(currentPlanningYear(new Date("2027-01-01T05:00:00Z"))).toBe(2027);
  });
});

describe("startsNextYear", () => {
  it("reads the switch from the stored start year", () => {
    expect(startsNextYear(2027, OCT_2026)).toBe(true);
    expect(startsNextYear(2026, OCT_2026)).toBe(false);
    expect(startsNextYear(2027, new Date("2027-01-02T15:00:00Z"))).toBe(false);
  });
});

describe("planDataYear", () => {
  it("data year never runs past the stored start", () => {
    expect(planDataYear(2027, OCT_2026)).toBe(2026);
    expect(planDataYear(2026, OCT_2026)).toBe(2026);
    expect(planDataYear(2024, OCT_2026)).toBe(2024); // stale row: no window
  });
});
