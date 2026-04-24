import { describe, it, expect } from "vitest";
import { buildTimeline } from "../build-timeline";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("buildTimeline", () => {
  it("returns events sorted by (year asc, category priority, then life-kind or subject)", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    const CATEGORY_ORDER: Record<string, number> = { life: 0, income: 1, transaction: 2, portfolio: 3, insurance: 4, tax: 5 };
    const SUBJECT_ORDER: Record<string, number> = { primary: 0, spouse: 1, joint: 2 };
    const LIFE_KIND_ORDER: Record<string, number> = { retire: 0, ss_claim: 1, ss_fra: 2, medicare: 3, death: 4 };
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const cur = events[i];
      expect(prev.year).toBeLessThanOrEqual(cur.year);
      if (prev.year === cur.year) {
        const c = CATEGORY_ORDER[prev.category] - CATEGORY_ORDER[cur.category];
        expect(c).toBeLessThanOrEqual(0);
        if (c === 0) {
          if (prev.category === "life") {
            const k = (LIFE_KIND_ORDER[prev.id.split(":")[1]] ?? 99) - (LIFE_KIND_ORDER[cur.id.split(":")[1]] ?? 99);
            expect(k).toBeLessThanOrEqual(0);
            if (k === 0) {
              expect(SUBJECT_ORDER[prev.subject] - SUBJECT_ORDER[cur.subject]).toBeLessThanOrEqual(0);
            }
          } else {
            expect(SUBJECT_ORDER[prev.subject] - SUBJECT_ORDER[cur.subject]).toBeLessThanOrEqual(0);
          }
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

  it("orders Retirement first among Life events in the same year", () => {
    // John retires at 65 (2035) and is Medicare-eligible at 65 (2035) — same year.
    // Retirement is the defining life milestone and must sort ahead of Medicare.
    const data = buildClientData();
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    const lifeEventsIn2035 = events.filter((e) => e.year === 2035 && e.category === "life" && e.subject === "primary");
    const retireIdx = lifeEventsIn2035.findIndex((e) => e.id === "life:retire:primary");
    const medicareIdx = lifeEventsIn2035.findIndex((e) => e.id === "life:medicare:primary");
    expect(retireIdx).toBeGreaterThanOrEqual(0);
    expect(medicareIdx).toBeGreaterThanOrEqual(0);
    expect(retireIdx).toBeLessThan(medicareIdx);
  });

  it("dedupes multiple ss_begin income events for the same subject down to one", () => {
    // Advisor data: two spouse SS incomes (e.g., retirement + spousal benefit),
    // neither with claimingAge — so the Life detector does NOT fire a ss_claim
    // event and the income detector previously emitted both rows to the timeline.
    const base = buildClientData();
    const data = {
      ...base,
      incomes: [
        ...base.incomes,
        {
          id: "inc-ss-jane-retire",
          type: "social_security" as const,
          name: "Jane SS retirement",
          annualAmount: 24000,
          startYear: 2032,
          endYear: 2055,
          growthRate: 0.02,
          owner: "spouse" as const,
        },
        {
          id: "inc-ss-jane-spousal",
          type: "social_security" as const,
          name: "Jane SS spousal",
          annualAmount: 12000,
          startYear: 2032,
          endYear: 2055,
          growthRate: 0.02,
          owner: "spouse" as const,
        },
      ],
    };
    const projection = runProjection(data);
    const events = buildTimeline(data, projection);
    const spouseSs = events.filter((e) => e.subject === "spouse" && e.id.startsWith("income:ss_begin:"));
    expect(spouseSs).toHaveLength(1);
  });
});
