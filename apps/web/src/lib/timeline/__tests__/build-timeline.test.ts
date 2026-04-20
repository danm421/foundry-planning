import { describe, it, expect } from "vitest";
import { buildTimeline } from "../build-timeline";
import { runProjection } from "@foundry/engine";
import { buildClientData } from "@foundry/engine/__tests__/fixtures";

describe("buildTimeline", () => {
  it("returns events sorted by (year asc, category priority, subject)", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    const CATEGORY_ORDER: Record<string, number> = { life: 0, income: 1, transaction: 2, portfolio: 3, insurance: 4, tax: 5 };
    const SUBJECT_ORDER: Record<string, number> = { primary: 0, spouse: 1, joint: 2 };
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const cur = events[i];
      expect(prev.year).toBeLessThanOrEqual(cur.year);
      if (prev.year === cur.year) {
        const c = CATEGORY_ORDER[prev.category] - CATEGORY_ORDER[cur.category];
        expect(c).toBeLessThanOrEqual(0);
        if (c === 0) {
          const s = SUBJECT_ORDER[prev.subject] - SUBJECT_ORDER[cur.subject];
          expect(s).toBeLessThanOrEqual(0);
        }
      }
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
    // Make the test non-vacuous: assert life:ss_claim:primary is actually present.
    expect(ssLife).toBeDefined();
    expect(ssIncome).toBeUndefined();
  });

  it("returns empty array for an empty projection", () => {
    const data = buildClientData();
    const events = buildTimeline(data, []);
    expect(events).toEqual([]);
  });
});
