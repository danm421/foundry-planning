import { describe, it, expect } from "vitest";
import { validateLayoutV4 } from "../validate-layout-v4";
import type { ComparisonLayoutV4 } from "../layout-schema";

const single = (kind: ComparisonLayoutV4["rows"][number]["cells"][number]["widget"]["kind"], planIds: string[]): ComparisonLayoutV4 => ({
  version: 4,
  title: "Validation Test",
  rows: [
    {
      id: "00000000-0000-0000-0000-000000000001",
      cells: [
        {
          id: "00000000-0000-0000-0000-000000000002",
          widget: { id: "00000000-0000-0000-0000-000000000003", kind, planIds },
        },
      ],
    },
  ],
});

describe("validateLayoutV4", () => {
  it("accepts a 'one' widget with exactly one plan", () => {
    const result = validateLayoutV4(single("kpi", ["plan-base"]));
    expect(result.ok).toBe(true);
  });

  it("rejects a 'one' widget with zero plans", () => {
    const result = validateLayoutV4(single("kpi", []));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/kpi.*expects exactly 1 plan/);
    }
  });

  it("rejects a 'one' widget with two plans", () => {
    const result = validateLayoutV4(single("kpi", ["plan-base", "plan-roth"]));
    expect(result.ok).toBe(false);
  });

  it("accepts a 'one-or-many' widget with 1, 2, or 4 plans", () => {
    expect(validateLayoutV4(single("portfolio", ["a"])).ok).toBe(true);
    expect(validateLayoutV4(single("portfolio", ["a", "b"])).ok).toBe(true);
    expect(validateLayoutV4(single("portfolio", ["a", "b", "c", "d"])).ok).toBe(true);
  });

  it("rejects a 'one-or-many' widget with zero plans", () => {
    const result = validateLayoutV4(single("portfolio", []));
    expect(result.ok).toBe(false);
  });

  it("accepts a 'many-only' widget with 2+ plans", () => {
    expect(validateLayoutV4(single("year-by-year", ["a", "b"])).ok).toBe(true);
    expect(validateLayoutV4(single("year-by-year", ["a", "b", "c"])).ok).toBe(true);
  });

  it("rejects a 'many-only' widget with 1 plan", () => {
    const result = validateLayoutV4(single("year-by-year", ["a"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/year-by-year.*expects 2 or more plans/);
    }
  });

  it("accepts a 'none' widget with zero plans", () => {
    expect(validateLayoutV4(single("text", [])).ok).toBe(true);
  });

  it("rejects a 'none' widget with one plan", () => {
    const result = validateLayoutV4(single("text", ["plan-base"]));
    expect(result.ok).toBe(false);
  });

  it("reports every offending widget when many are wrong", () => {
    const layout: ComparisonLayoutV4 = {
      version: 4,
      title: "Validation Test",
      rows: [
        {
          id: "00000000-0000-0000-0000-0000000000a1",
          cells: [
            {
              id: "00000000-0000-0000-0000-0000000000a2",
              widget: {
                id: "00000000-0000-0000-0000-0000000000a3",
                kind: "kpi",
                planIds: [],
              },
            },
            {
              id: "00000000-0000-0000-0000-0000000000a4",
              widget: {
                id: "00000000-0000-0000-0000-0000000000a5",
                kind: "year-by-year",
                planIds: ["only-one"],
              },
            },
          ],
        },
      ],
    };
    const result = validateLayoutV4(layout);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });
});
