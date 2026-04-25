import { describe, it, expect } from "vitest";
import { deriveLifeEvents } from "../derive-life-events";
import type { TimelineEvent } from "@/lib/timeline/timeline-types";

const baseEvent = (id: string, year: number, title: string): TimelineEvent => ({
  id,
  year,
  age: 65,
  category: "life",
  subject: "primary",
  title,
  details: [],
});

describe("deriveLifeEvents", () => {
  it("maps retire, ss_claim, death to retirement / social_security / life_expectancy", () => {
    const events: TimelineEvent[] = [
      baseEvent("life:retire:primary", 2040, "Retirement"),
      baseEvent("life:ss_claim:primary", 2042, "Social Security begins"),
      baseEvent("life:death:primary", 2065, "End of life"),
    ];
    expect(deriveLifeEvents(events)).toEqual([
      { year: 2040, label: "Retirement", kind: "retirement" },
      { year: 2042, label: "Social Security begins", kind: "social_security" },
      { year: 2065, label: "End of life", kind: "life_expectancy" },
    ]);
  });

  it("drops medicare and ss_fra (not in spec kinds)", () => {
    const events: TimelineEvent[] = [
      baseEvent("life:medicare:primary", 2035, "Medicare eligibility"),
      baseEvent("life:ss_fra:primary", 2037, "Social Security FRA"),
      baseEvent("life:retire:primary", 2040, "Retirement"),
    ];
    const result = deriveLifeEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("retirement");
  });

  it("sorts by year ascending", () => {
    const events: TimelineEvent[] = [
      baseEvent("life:death:primary", 2065, "End of life"),
      baseEvent("life:retire:primary", 2040, "Retirement"),
      baseEvent("life:ss_claim:primary", 2042, "Social Security begins"),
    ];
    const years = deriveLifeEvents(events).map((e) => e.year);
    expect(years).toEqual([2040, 2042, 2065]);
  });

  it("dedups same-year same-kind, keeping primary subject", () => {
    const events: TimelineEvent[] = [
      { ...baseEvent("life:retire:spouse", 2040, "Retirement"), subject: "spouse" },
      baseEvent("life:retire:primary", 2040, "Retirement"),
    ];
    const result = deriveLifeEvents(events);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no life events match", () => {
    expect(deriveLifeEvents([])).toEqual([]);
  });
});
