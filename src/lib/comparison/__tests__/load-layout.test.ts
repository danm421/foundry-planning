import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadLayout, parseSavedLayout } from "../load-layout";
import { ComparisonLayoutV5Schema } from "../layout-schema";

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

  it("returns a v5 default when no row exists", async () => {
    select.mockResolvedValue([]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout.version).toBe(5);
    expect(layout.title).toBe("Test Report");
    expect(ComparisonLayoutV5Schema.safeParse(layout).success).toBe(true);
    // Default: single group with one span-5 placeholder cell
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0].cells).toHaveLength(1);
    expect(layout.groups[0].cells[0].span).toBe(5);
    expect(layout.groups[0].cells[0].widget).toBeNull();
  });

  it("returns a stored v4 layout migrated to v5", async () => {
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
    expect(layout.version).toBe(5);
    expect(layout.title).toBe("Stored");
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0].cells[0].span).toBe(5);
    expect(layout.groups[0].cells[0].widget?.kind).toBe("portfolio");
  });

  it("migrates a stored v3 layout into v5", async () => {
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
    expect(layout.version).toBe(5);
    // portfolio becomes 1 group of 1 cell (span 5), kpi-strip expands into a group of 5 cells.
    expect(layout.groups).toHaveLength(2);
    expect(layout.groups[0].cells).toHaveLength(1);
    expect(layout.groups[0].cells[0].span).toBe(5);
    expect(layout.groups[1].cells).toHaveLength(5);
    // planIds default to primary
    expect(layout.groups[0].cells[0].widget?.planIds).toEqual(["base"]);
  });

  it("migrates a stored v2 layout via v3 → v4 → v5", async () => {
    const v2 = {
      version: 2,
      yearRange: null,
      items: [
        { instanceId: "33333333-3333-4333-8333-333333333333", kind: "portfolio", hidden: false },
      ],
    };
    select.mockResolvedValue([{ layout: v2 }]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout.version).toBe(5);
    expect(layout.groups[0].cells[0].widget?.kind).toBe("portfolio");
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
    expect(layout.groups[0].cells[0].widget?.planIds).toEqual(["base", "scenario-x"]);
  });

  it("falls back to default on unparseable saved layout", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    select.mockResolvedValue([{ layout: { not: "anything", we: "recognize" } }]);
    const layout = await loadLayout("c", "f", ctx);
    expect(layout.version).toBe(5);
    expect(layout.groups).toHaveLength(1); // default = single blank group
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("parseSavedLayout v5 dispatch", () => {
  it("returns a v5 payload unchanged", () => {
    const v5 = {
      version: 5 as const,
      title: "R",
      groups: [{ id: "g", title: "", cells: [{ id: "c", span: 5 as const, widget: null }] }],
    };
    expect(parseSavedLayout(v5, ctx)).toEqual(v5);
  });

  it("migrates a v4 payload to v5", () => {
    const v4 = {
      version: 4 as const,
      title: "R",
      rows: [
        {
          id: "r",
          cells: [
            {
              id: "c",
              widget: { id: "w", kind: "portfolio" as const, planIds: ["base"] },
            },
          ],
        },
      ],
    };
    const out = parseSavedLayout(v4, ctx);
    expect(out?.version).toBe(5);
    expect(out?.groups[0].cells[0].span).toBe(5);
    expect(out?.groups[0].cells[0].widget?.kind).toBe("portfolio");
  });

  it("migrates a v3 payload through v4 to v5", () => {
    const v3 = {
      version: 3 as const,
      yearRange: null,
      items: [{ instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio" as const }],
    };
    const out = parseSavedLayout(v3, ctx);
    expect(out?.version).toBe(5);
    expect(out?.groups).toHaveLength(1);
  });

  it("returns null for unrecognized payloads", () => {
    expect(parseSavedLayout({ foo: "bar" }, ctx)).toBe(null);
  });
});
