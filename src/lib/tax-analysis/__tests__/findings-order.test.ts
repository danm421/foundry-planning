import { describe, it, expect } from "vitest";
import type { Finding } from "../types";
import { sortFindings, SEVERITY_GROUPS, CATEGORY_LABEL } from "../findings/order";

const make = (id: string, severity: Finding["severity"], estimatedImpact: number | null): Finding => ({
  id, severity, category: "business",
  headline: id, whatTheReturnShows: "x", whyItMatters: "x", whatToConsider: "x",
  lineRefs: [], estimatedImpact, numbers: {},
});

describe("sortFindings", () => {
  it("orders by severity group, then impact descending, nulls last within a group", () => {
    const sorted = sortFindings([
      make("info-big", "info", 9000),
      make("opp-null", "opportunity", null),
      make("watch-small", "watch", 10),
      make("opp-small", "opportunity", 100),
      make("opp-big", "opportunity", 5000),
    ]);
    expect(sorted.map((f) => f.id)).toEqual([
      "opp-big", "opp-small", "opp-null", "watch-small", "info-big",
    ]);
  });

  it("is stable — equal impact keeps build order, so a rebuild never reshuffles", () => {
    const sorted = sortFindings([make("a", "watch", 500), make("b", "watch", 500)]);
    expect(sorted.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = [make("z", "info", 1), make("a", "opportunity", 2)];
    sortFindings(input);
    expect(input.map((f) => f.id)).toEqual(["z", "a"]);
  });

  it("labels every category — a missing entry would render a blank chip", () => {
    expect(Object.values(CATEGORY_LABEL).every((v) => v.length > 0)).toBe(true);
    expect(SEVERITY_GROUPS.map((g) => g.severity)).toEqual(["opportunity", "watch", "info"]);
  });
});
