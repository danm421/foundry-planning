import { describe, it, expect } from "vitest";
import type { ClientInfo } from "@/engine/types";
import { buildLifeEventsByYear, lifeEventMarkers, type LifeEventsByYear } from "@/lib/life-event-markers";

const annRetires = { label: "Ann retires", color: "blue", person: "client", name: "Ann", kind: "retires", age: 65 } as const;
const boRetires = { label: "Bo retires", color: "pink", person: "spouse", name: "Bo", kind: "retires", age: 63 } as const;
const annPasses = { label: "Ann passes", color: "blue", person: "client", name: "Ann", kind: "passes", age: 90 } as const;
const boPasses = { label: "Bo passes", color: "pink", person: "spouse", name: "Bo", kind: "passes", age: 94 } as const;

const events: LifeEventsByYear = {
  2030: [annRetires, boRetires],
  2055: [annPasses],
  2061: [boPasses],
};

const yearsFrom = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, i) => ({ year: first + i }));

describe("lifeEventMarkers", () => {
  it("indexes each event from the first charted year, keeping same-year pairs", () => {
    expect(lifeEventMarkers(events, yearsFrom(2026, 2060))).toEqual([
      { yearIndex: 4, year: 2030, ...annRetires },
      { yearIndex: 4, year: 2030, ...boRetires },
      { yearIndex: 29, year: 2055, ...annPasses },
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

describe("buildLifeEventsByYear", () => {
  it("tags each event with its person, so the chart can give each one a row", () => {
    const client = {
      firstName: "Ann",
      dateOfBirth: "1965-04-01",
      retirementAge: 65,
      lifeExpectancy: 90,
      spouseName: "Bo",
      spouseDob: "1967-09-12",
      spouseRetirementAge: 63,
      spouseLifeExpectancy: 94,
    } as ClientInfo;
    expect(buildLifeEventsByYear(client)).toEqual({
      2030: [
        { ...annRetires, color: expect.any(String) },
        { ...boRetires, color: expect.any(String) },
      ],
      2055: [{ ...annPasses, color: expect.any(String) }],
      2061: [{ ...boPasses, color: expect.any(String) }],
    });
  });
});
