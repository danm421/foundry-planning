import { describe, expect, it } from "vitest";
import { cloneComparisonTemplate } from "./clone";
import type { TemplateLayoutV5 } from "./types";

const layout: TemplateLayoutV5 = {
  version: 5,
  title: "X",
  groups: [
    {
      id: "g1",
      title: "",
      cells: [
        { id: "c1", span: 2, widget: { id: "w1", kind: "monte-carlo", planIds: ["A", "B"] } },
        { id: "c2", span: 2, widget: null },
      ],
    },
  ],
};

describe("cloneComparisonTemplate", () => {
  it("regenerates ids for groups, cells, and widgets", () => {
    const out = cloneComparisonTemplate(layout);
    expect(out.groups[0].id).not.toBe("g1");
    expect(out.groups[0].cells[0].id).not.toBe("c1");
    expect(out.groups[0].cells[0].widget!.id).not.toBe("w1");
  });

  it("preserves layout shape and non-id widget fields", () => {
    const out = cloneComparisonTemplate(layout);
    expect(out.version).toBe(5);
    expect(out.groups[0].cells[0].widget!.kind).toBe("monte-carlo");
    expect(out.groups[0].cells[0].widget!.planIds).toEqual(["A", "B"]);
    expect(out.groups[0].cells[1].widget).toBeNull();
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(layout);
    cloneComparisonTemplate(layout);
    expect(JSON.stringify(layout)).toBe(before);
  });
});
