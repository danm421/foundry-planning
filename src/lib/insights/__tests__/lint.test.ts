import { describe, it, expect } from "vitest";
import { computeNeedsAttention } from "../lint";

const TODAY = new Date("2026-07-10T00:00:00Z");
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

describe("computeNeedsAttention", () => {
  it("returns nothing when everything is current", () => {
    expect(
      computeNeedsAttention(
        { overdueTaskCount: 0, lastContactAt: daysAgo(10), oldestAccountValuationAt: daysAgo(30) },
        TODAY,
      ),
    ).toEqual([]);
  });
  it("flags overdue tasks", () => {
    const f = computeNeedsAttention(
      { overdueTaskCount: 3, lastContactAt: daysAgo(1), oldestAccountValuationAt: daysAgo(1) },
      TODAY,
    );
    expect(f.map((x) => x.kind)).toContain("overdue_task");
    expect(f.find((x) => x.kind === "overdue_task")!.message).toContain("3");
  });
  it("flags stale valuations past 180 days and no-contact past 90 days", () => {
    const f = computeNeedsAttention(
      { overdueTaskCount: 0, lastContactAt: daysAgo(120), oldestAccountValuationAt: daysAgo(200) },
      TODAY,
    );
    expect(f.map((x) => x.kind).sort()).toEqual(["no_contact", "stale_valuation"]);
  });
  it("treats a null lastContact as no-contact", () => {
    const f = computeNeedsAttention(
      { overdueTaskCount: 0, lastContactAt: null, oldestAccountValuationAt: null },
      TODAY,
    );
    expect(f.map((x) => x.kind)).toEqual(["no_contact"]);
  });
});
