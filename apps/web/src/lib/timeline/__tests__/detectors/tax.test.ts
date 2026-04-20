import { describe, it, expect } from "vitest";
import { detectTaxEvents } from "../../detectors/tax";
import { runProjection } from "@foundry/engine";
import { buildClientData } from "@foundry/engine/__tests__/fixtures";

describe("detectTaxEvents", () => {
  it("emits first-negative-cashflow at most once", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectTaxEvents(data, projection);
    const negs = events.filter((e) => e.id === "tax:first_negative_cashflow");
    expect(negs.length).toBeLessThanOrEqual(1);
  });

  it("emits bracket change events keyed by year", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectTaxEvents(data, projection);
    const bracketEvents = events.filter((e) => e.id.startsWith("tax:bracket_change:"));
    const years = new Set(bracketEvents.map((e) => e.year));
    // No duplicate year events for bracket changes.
    expect(years.size).toBe(bracketEvents.length);
  });
});
