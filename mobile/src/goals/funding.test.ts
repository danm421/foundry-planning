// mobile/src/goals/funding.test.ts
//
// Presentation rules for the Goals funded tile. Mirrors the web tile
// (src/components/portal/dashboard-tiles/tile-goals-funded.tsx) — the two
// surfaces read the same projection, so a goal that shows green on the web
// must not show amber on the phone.
import { describe, it, expect } from "vitest";
import type { PortalGoalFunding } from "@contracts";
import { goalTone, goalYearRange, goalGapLabel } from "./funding";

const goal = (over: Partial<PortalGoalFunding> = {}): PortalGoalFunding => ({
  id: "retirement",
  kind: "retirement",
  label: "Retirement",
  forName: null,
  startYear: 2040,
  endYear: 2065,
  cost: 100_000,
  funded: 100_000,
  pctFunded: 1,
  ...over,
});

describe("goalTone", () => {
  it("reads fully funded as good", () => {
    expect(goalTone(1)).toBe("good");
  });

  // 0.995 is the web's rounding boundary: it renders "100%", so it has to read
  // green too, or the tile shows a green number above an amber bar.
  it("treats the 99.5% rounding boundary as fully funded", () => {
    expect(goalTone(0.995)).toBe("good");
  });

  it("reads just under the boundary as a warning, not a failure", () => {
    expect(goalTone(0.994)).toBe("warn");
    expect(goalTone(0.9)).toBe("warn");
  });

  it("reads a real gap as critical", () => {
    expect(goalTone(0.899)).toBe("crit");
    expect(goalTone(0)).toBe("crit");
  });
});

describe("goalYearRange", () => {
  it("joins a multi-year goal with an en dash", () => {
    expect(goalYearRange(goal({ startYear: 2040, endYear: 2065 }))).toBe("2040–2065");
  });

  it("collapses a single-year goal to one year", () => {
    expect(goalYearRange(goal({ startYear: 2040, endYear: 2040 }))).toBe("2040");
  });

  it("collapses to the start year when there is no end year", () => {
    expect(goalYearRange(goal({ startYear: 2040, endYear: null }))).toBe("2040");
  });

  it("renders nothing when the goal costs nothing and has no years", () => {
    expect(goalYearRange(goal({ startYear: null, endYear: null }))).toBeNull();
  });
});

describe("goalGapLabel", () => {
  it("names the shortfall and the total when a goal is underfunded", () => {
    expect(goalGapLabel(goal({ cost: 100_000, funded: 60_000 }))).toBe(
      "$40,000 short of $100,000",
    );
  });

  it("says funded when the goal is covered", () => {
    expect(goalGapLabel(goal({ cost: 100_000, funded: 100_000 }))).toBe("$100,000 funded");
  });

  // Overfunding is not a shortfall — the gap clamps at zero rather than
  // rendering a negative "short of".
  it("never reports a negative shortfall when a goal is overfunded", () => {
    expect(goalGapLabel(goal({ cost: 100_000, funded: 140_000 }))).toBe("$100,000 funded");
  });
});
