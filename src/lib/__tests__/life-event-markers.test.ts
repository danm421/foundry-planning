import { describe, it, expect } from "vitest";
import { lifeEventMarkers, type LifeEventsByYear } from "@/lib/life-event-markers";

const events: LifeEventsByYear = {
  2030: [
    { label: "Ann retires", color: "blue" },
    { label: "Bo retires", color: "pink" },
  ],
  2055: [{ label: "Ann passes", color: "blue" }],
  2061: [{ label: "Bo passes", color: "pink" }],
};

const yearsFrom = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, i) => ({ year: first + i }));

describe("lifeEventMarkers", () => {
  it("indexes each event from the first charted year, keeping same-year pairs", () => {
    expect(lifeEventMarkers(events, yearsFrom(2026, 2060))).toEqual([
      { yearIndex: 4, label: "Ann retires", color: "blue" },
      { yearIndex: 4, label: "Bo retires", color: "pink" },
      { yearIndex: 29, label: "Ann passes", color: "blue" },
    ]);
  });

  it("includes events on the first and last charted year", () => {
    expect(lifeEventMarkers(events, yearsFrom(2030, 2055)).map((m) => m.yearIndex)).toEqual([
      0, 0, 25,
    ]);
  });

  it("returns nothing when no event falls in the charted years", () => {
    expect(lifeEventMarkers({}, yearsFrom(2026, 2060))).toEqual([]);
    expect(lifeEventMarkers(events, yearsFrom(2031, 2054))).toEqual([]);
    expect(lifeEventMarkers(events, [])).toEqual([]);
  });
});
