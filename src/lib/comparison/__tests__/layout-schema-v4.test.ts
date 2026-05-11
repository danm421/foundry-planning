import { describe, it, expect } from "vitest";
import {
  ComparisonLayoutV4Schema,
  WIDGET_KINDS_V4,
  type ComparisonLayoutV4,
} from "../layout-schema";

const validLayout: ComparisonLayoutV4 = {
  version: 4,
  title: "Test Layout",
  rows: [
    {
      id: "row-1",
      cells: [
        {
          id: "cell-1",
          widget: {
            id: "widget-1",
            kind: "portfolio",
            planIds: ["plan-base"],
          },
        },
      ],
    },
  ],
};

describe("ComparisonLayoutV4Schema", () => {
  it("parses a minimal valid v4 layout", () => {
    const result = ComparisonLayoutV4Schema.safeParse(validLayout);
    expect(result.success).toBe(true);
  });

  it("rejects a row with zero cells", () => {
    const bad = {
      version: 4,
      rows: [{ id: "row-1", cells: [] }],
    };
    const result = ComparisonLayoutV4Schema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a row with more than 5 cells", () => {
    const sixCells = Array.from({ length: 6 }, (_, i) => ({
      id: `cell-${i}`,
      widget: { id: `w-${i}`, kind: "kpi" as const, planIds: ["plan-base"] },
    }));
    const bad = {
      version: 4,
      rows: [{ id: "row-1", cells: sixCells }],
    };
    const result = ComparisonLayoutV4Schema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown widget kind", () => {
    const bad = {
      version: 4,
      rows: [
        {
          id: "row-1",
          cells: [
            {
              id: "cell-1",
              widget: { id: "w-1", kind: "not-a-real-kind", planIds: [] },
            },
          ],
        },
      ],
    };
    const result = ComparisonLayoutV4Schema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts an optional yearRange per widget", () => {
    const layout: ComparisonLayoutV4 = {
      version: 4,
      title: "Test Layout",
      rows: [
        {
          id: "row-1",
          cells: [
            {
              id: "cell-1",
              widget: {
                id: "w-1",
                kind: "portfolio",
                planIds: ["plan-base"],
                yearRange: { start: 2026, end: 2065 },
              },
            },
          ],
        },
      ],
    };
    expect(ComparisonLayoutV4Schema.safeParse(layout).success).toBe(true);
  });

  it("rejects a widget where yearRange.start > yearRange.end", () => {
    const bad = {
      version: 4,
      rows: [
        {
          id: "row-1",
          cells: [
            {
              id: "cell-1",
              widget: {
                id: "w-1",
                kind: "portfolio",
                planIds: ["plan-base"],
                yearRange: { start: 2065, end: 2026 },
              },
            },
          ],
        },
      ],
    };
    expect(ComparisonLayoutV4Schema.safeParse(bad).success).toBe(false);
  });

  it("includes 'kpi' in WIDGET_KINDS_V4", () => {
    expect(WIDGET_KINDS_V4).toContain("kpi");
  });

  it("requires a string title", () => {
    const noTitle = {
      version: 4,
      rows: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          cells: [
            {
              id: "00000000-0000-0000-0000-000000000002",
              widget: {
                id: "00000000-0000-0000-0000-000000000003",
                kind: "portfolio",
                planIds: ["plan-base"],
              },
            },
          ],
        },
      ],
    };
    expect(ComparisonLayoutV4Schema.safeParse(noTitle).success).toBe(false);

    const withTitle = { ...noTitle, title: "My Report" };
    expect(ComparisonLayoutV4Schema.safeParse(withTitle).success).toBe(true);
  });

  it("rejects a non-string title", () => {
    const bad = {
      version: 4,
      title: 42,
      rows: [],
    };
    expect(ComparisonLayoutV4Schema.safeParse(bad).success).toBe(false);
  });
});
