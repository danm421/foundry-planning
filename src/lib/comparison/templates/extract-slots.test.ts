import { describe, expect, it } from "vitest";
import { extractSlots } from "./extract-slots";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";

const clientLayout: ComparisonLayoutV5 = {
  version: 5,
  title: "Custom",
  groups: [
    {
      id: "g1",
      title: "",
      cells: [
        { id: "c1", span: 2, widget: { id: "w1", kind: "monte-carlo", planIds: ["scen-base", "scen-roth"] } },
        { id: "c2", span: 2, widget: { id: "w2", kind: "lifetime-tax", planIds: ["scen-roth", "scen-base"] } },
        { id: "c3", span: 4, widget: null },
      ],
    },
  ],
};

describe("extractSlots", () => {
  it("assigns slot tokens in order of first appearance and rewrites planIds", () => {
    const { layout, slotLabels } = extractSlots(clientLayout, {
      "scen-base": "Current Plan",
      "scen-roth": "Roth Plan",
    });
    expect(slotLabels).toEqual(["Current Plan", "Roth Plan"]);
    expect(layout.groups[0].cells[0].widget!.planIds).toEqual(["A", "B"]);
    expect(layout.groups[0].cells[1].widget!.planIds).toEqual(["B", "A"]);
    expect(layout.groups[0].cells[2].widget).toBeNull();
  });

  it("uses 'Plan A', 'Plan B' as fallback labels when nameByPlanId is missing entries", () => {
    const { slotLabels } = extractSlots(clientLayout, {});
    expect(slotLabels).toEqual(["Plan A", "Plan B"]);
  });

  it("throws if more than 8 unique plans are referenced", () => {
    const big: ComparisonLayoutV5 = {
      version: 5,
      title: "",
      groups: [
        {
          id: "g",
          title: "",
          cells: Array.from({ length: 9 }, (_, i) => ({
            id: `c${i}`,
            span: 1 as const,
            widget: { id: `w${i}`, kind: "monte-carlo" as const, planIds: [`p${i}`] },
          })),
        },
      ],
    };
    expect(() => extractSlots(big, {})).toThrow(/at most 8 unique plans/);
  });

  it("does not mutate the input layout", () => {
    const before = JSON.stringify(clientLayout);
    extractSlots(clientLayout, {});
    expect(JSON.stringify(clientLayout)).toBe(before);
  });
});
