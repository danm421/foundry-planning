import { describe, it, expect } from "vitest";
import { resolveImportTiming } from "@/lib/imports/commit/timing";
import type { ClientMilestones } from "@/lib/milestones";

const milestones: ClientMilestones = {
  planStart: 2026,
  planEnd: 2061,
  clientRetirement: 2035,
  clientEnd: 2061,
  // no spouse
};

describe("resolveImportTiming", () => {
  it("resolves a start ref to its milestone year", () => {
    const t = resolveImportTiming({ startYearRef: "client_retirement" }, milestones);
    expect(t.start).toEqual({ year: 2035, ref: "client_retirement" });
  });

  it("resolves an end transition ref to year-1 (position end)", () => {
    const t = resolveImportTiming({ endYearRef: "client_retirement" }, milestones);
    expect(t.end).toEqual({ year: 2034, ref: "client_retirement" });
  });

  it("keeps a manual year and clears the ref", () => {
    const t = resolveImportTiming({ startYear: 2040 }, milestones);
    expect(t.start).toEqual({ year: 2040, ref: null });
  });

  it("drops an unresolvable spouse ref and falls back to the year", () => {
    const t = resolveImportTiming(
      { startYear: 2030, startYearRef: "spouse_retirement" },
      milestones,
    );
    expect(t.start).toEqual({ year: 2030, ref: null });
  });

  it("drops a ref entirely when no milestones are available", () => {
    const t = resolveImportTiming({ startYearRef: "client_retirement", startYear: 2031 }, undefined);
    expect(t.start).toEqual({ year: 2031, ref: null });
  });

  it("returns empty fields when nothing is provided", () => {
    const t = resolveImportTiming({}, milestones);
    expect(t.start).toEqual({});
    expect(t.end).toEqual({});
  });
});
