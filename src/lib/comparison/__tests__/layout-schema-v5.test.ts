import { describe, it, expect } from "vitest";
import { ComparisonLayoutV5Schema } from "../layout-schema";

const validV5 = {
  version: 5 as const,
  title: "Comparison",
  groups: [
    {
      id: "g1",
      title: "Summary",
      cells: [
        { id: "c1", span: 3, widget: { id: "w1", kind: "portfolio", planIds: ["base"] } },
        { id: "c2", span: 2, widget: null },
      ],
    },
  ],
};

describe("ComparisonLayoutV5Schema", () => {
  it("parses a valid v5 layout", () => {
    expect(ComparisonLayoutV5Schema.parse(validV5)).toEqual(validV5);
  });

  it("rejects span 0 and span 6", () => {
    const bad0 = { ...validV5, groups: [{ ...validV5.groups[0], cells: [{ id: "c1", span: 0, widget: null }] }] };
    const bad6 = { ...validV5, groups: [{ ...validV5.groups[0], cells: [{ id: "c1", span: 6, widget: null }] }] };
    expect(ComparisonLayoutV5Schema.safeParse(bad0).success).toBe(false);
    expect(ComparisonLayoutV5Schema.safeParse(bad6).success).toBe(false);
  });

  it("accepts widget: null", () => {
    const empty = { ...validV5, groups: [{ ...validV5.groups[0], cells: [{ id: "c1", span: 5, widget: null }] }] };
    expect(ComparisonLayoutV5Schema.safeParse(empty).success).toBe(true);
  });

  it("rejects version 4 payload", () => {
    expect(ComparisonLayoutV5Schema.safeParse({ ...validV5, version: 4 }).success).toBe(false);
  });
});
