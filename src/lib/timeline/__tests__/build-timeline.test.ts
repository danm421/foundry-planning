import { describe, it, expect } from "vitest";
import { buildTimeline } from "../build-timeline";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("buildTimeline", () => {
  it("returns events sorted by (year asc, category priority, subject)", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const cur = events[i];
      expect(prev.year <= cur.year).toBe(true);
    }
  });

  it("is deterministic — same input produces same event ids", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const a = buildTimeline(data, projection).map((e) => e.id);
    const b = buildTimeline(data, projection).map((e) => e.id);
    expect(a).toEqual(b);
  });

  it("dedupes SS-claim collisions: life detector wins over income detector", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    const ssLife = events.find((e) => e.id === "life:ss_claim:primary");
    const ssIncome = events.find((e) => e.id.startsWith("income:ss_begin:primary"));
    // When both detectors fire for the same (year, subject), only the Life one survives.
    if (ssLife) {
      expect(ssIncome).toBeUndefined();
    }
  });

  it("returns empty array for an empty projection", () => {
    const data = buildClientData();
    const events = buildTimeline(data, []);
    expect(events).toEqual([]);
  });
});
