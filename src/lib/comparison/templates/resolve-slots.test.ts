import { describe, expect, it } from "vitest";
import { resolveSlots } from "./resolve-slots";
import type { TemplateLayoutV5 } from "./types";

const templateLayout: TemplateLayoutV5 = {
  version: 5,
  title: "Retirement Readiness",
  groups: [
    {
      id: "g1",
      title: "",
      cells: [
        {
          id: "c1",
          span: 2,
          widget: {
            id: "w1",
            kind: "monte-carlo",
            planIds: ["A", "B"],
          },
        },
        {
          id: "c2",
          span: 2,
          widget: null,
        },
      ],
    },
  ],
};

describe("resolveSlots", () => {
  it("replaces slot tokens in widget.planIds with mapped scenario ids", () => {
    const out = resolveSlots(templateLayout, {
      A: "scen-base",
      B: "scen-proposed",
    });
    expect(out.groups[0].cells[0].widget!.planIds).toEqual([
      "scen-base",
      "scen-proposed",
    ]);
  });

  it("preserves null widgets in cells", () => {
    const out = resolveSlots(templateLayout, { A: "x", B: "y" });
    expect(out.groups[0].cells[1].widget).toBeNull();
  });

  it("throws if a referenced slot is missing from the mapping", () => {
    expect(() =>
      resolveSlots(templateLayout, { A: "x" }),
    ).toThrow(/missing mapping for slot 'B'/);
  });

  it("does not mutate the input layout", () => {
    const before = JSON.stringify(templateLayout);
    resolveSlots(templateLayout, { A: "x", B: "y" });
    expect(JSON.stringify(templateLayout)).toBe(before);
  });
});
