import { describe, it, expect } from "vitest";
import { validateLayoutV5 } from "../validate-layout-v5";
import type { ComparisonLayoutV5 } from "../layout-schema";

const single = (
  span: 1 | 2 | 3 | 4 | 5,
  widget: ComparisonLayoutV5["groups"][number]["cells"][number]["widget"],
): ComparisonLayoutV5 => ({
  version: 5,
  title: "T",
  groups: [{ id: "g1", title: "", cells: [{ id: "c1", span, widget }] }],
});

describe("validateLayoutV5", () => {
  it("accepts an empty placeholder cell regardless of widget config", () => {
    expect(validateLayoutV5(single(5, null)).ok).toBe(true);
  });

  it("rejects a 'one' widget with zero plans", () => {
    const result = validateLayoutV5(
      single(2, { id: "w", kind: "kpi", planIds: [] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/kpi.*expects exactly 1 plan/);
  });

  it("accepts a populated 'one-or-many' widget with 1 plan", () => {
    expect(
      validateLayoutV5(single(3, { id: "w", kind: "portfolio", planIds: ["base"] })).ok,
    ).toBe(true);
  });

  it("rejects a 'many-only' widget with 1 plan", () => {
    const result = validateLayoutV5(
      single(5, { id: "w", kind: "year-by-year", planIds: ["only"] }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a group whose cells' spans wrap (sum > 5 across cells)", () => {
    const layout: ComparisonLayoutV5 = {
      version: 5,
      title: "T",
      groups: [
        {
          id: "g",
          title: "",
          cells: [
            { id: "c1", span: 5, widget: null },
            { id: "c2", span: 5, widget: null },
          ],
        },
      ],
    };
    expect(validateLayoutV5(layout).ok).toBe(true);
  });

  it("rejects unknown widget kind", () => {
    const layout = single(5, { id: "w", kind: "made-up" as never, planIds: [] });
    expect(validateLayoutV5(layout).ok).toBe(false);
  });
});
