import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadLayout } from "../load-layout";
import { ComparisonLayoutV4Schema } from "../layout-schema";

const select = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => select(...args),
      }),
    }),
  },
}));

const ctx = { primaryScenarioId: "base", urlPlanIds: null, defaultTitle: "Test Report" };

describe("loadLayout", () => {
  beforeEach(() => select.mockReset());

  it("returns the v4 default when no row exists", async () => {
    select.mockResolvedValue([]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout.version).toBe(4);
    expect(layout.title).toBe("Test Report");
    expect(ComparisonLayoutV4Schema.safeParse(layout).success).toBe(true);
    // Spec default: 5 kpis + 4 more rows = 5 rows.
    expect(layout.rows).toHaveLength(5);
  });

  it("returns a stored v4 layout unchanged", async () => {
    const stored = {
      version: 4,
      title: "Stored",
      rows: [
        {
          id: "00000000-0000-0000-0000-00000000aa01",
          cells: [
            {
              id: "00000000-0000-0000-0000-00000000aa02",
              widget: {
                id: "00000000-0000-0000-0000-00000000aa03",
                kind: "portfolio",
                planIds: ["plan-base"],
              },
            },
          ],
        },
      ],
    };
    select.mockResolvedValue([{ layout: stored }]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout).toEqual(stored);
  });

  it("migrates a stored v3 layout into v4", async () => {
    const v3 = {
      version: 3,
      yearRange: { start: 2026, end: 2065 },
      items: [
        { instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio" },
        { instanceId: "22222222-2222-4222-8222-222222222222", kind: "kpi-strip" },
      ],
    };
    select.mockResolvedValue([{ layout: v3 }]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout.version).toBe(4);
    // portfolio becomes 1 row of 1 cell, kpi-strip expands into a 5-cell row.
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows[0].cells).toHaveLength(1);
    expect(layout.rows[1].cells).toHaveLength(5);
    // planIds default to primary
    expect(layout.rows[0].cells[0].widget.planIds).toEqual(["base"]);
  });

  it("migrates a stored v2 layout via v3 → v4", async () => {
    const v2 = {
      version: 2,
      yearRange: null,
      items: [
        { instanceId: "33333333-3333-4333-8333-333333333333", kind: "portfolio", hidden: false },
      ],
    };
    select.mockResolvedValue([{ layout: v2 }]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout.version).toBe(4);
    expect(layout.rows[0].cells[0].widget.kind).toBe("portfolio");
  });

  it("seeds planIds from ctx.urlPlanIds when migrating v3", async () => {
    const v3 = {
      version: 3,
      yearRange: null,
      items: [{ instanceId: "44444444-4444-4444-8444-444444444444", kind: "portfolio" }],
    };
    select.mockResolvedValue([{ layout: v3 }]);
    const layout = await loadLayout("c", "f", {
      primaryScenarioId: "base",
      urlPlanIds: ["base", "scenario-x"],
    });
    expect(layout.rows[0].cells[0].widget.planIds).toEqual(["base", "scenario-x"]);
  });

  it("falls back to default on unparseable saved layout", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    select.mockResolvedValue([{ layout: { not: "anything", we: "recognize" } }]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout.version).toBe(4);
    expect(layout.rows).toHaveLength(5); // default-layout-v4 shape
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
