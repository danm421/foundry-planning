import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadLayout } from "../load-layout";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@/db/schema", () => ({
  clientComparisonLayouts: { clientId: "client_id", firmId: "firm_id", layout: "layout" },
}));

import { db } from "@/db";

beforeEach(() => {
  vi.clearAllMocks();
});

function mockSelect(rows: Array<{ layout: unknown }>) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

describe("loadLayout", () => {
  it("returns the default layout when no row exists", async () => {
    mockSelect([]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.version).toBe(3);
    expect(layout.items.length).toBe(11);
  });

  it("loads a v1 layout as v3 with yearRange: null (legacy passthrough, hidden dropped)", async () => {
    mockSelect([
      {
        layout: {
          version: 1,
          items: [
            {
              instanceId: "11111111-1111-4111-8111-111111111111",
              kind: "portfolio",
              hidden: false,
              collapsed: false,
            },
            {
              instanceId: "22222222-2222-4222-8222-222222222222",
              kind: "monte-carlo",
              hidden: true,
              collapsed: false,
            },
          ],
        },
      },
    ]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.version).toBe(3);
    expect(layout.yearRange).toBeNull();
    expect(layout.items.map((i) => i.kind)).toEqual(["portfolio"]);
    expect("hidden" in layout.items[0]).toBe(false);
    expect("collapsed" in layout.items[0]).toBe(false);
  });

  it("loads a v2 layout as v3, preserving yearRange and dropping hidden items", async () => {
    mockSelect([
      {
        layout: {
          version: 2,
          yearRange: { start: 2030, end: 2055 },
          items: [
            { instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio", hidden: false, collapsed: false },
            { instanceId: "22222222-2222-4222-8222-222222222222", kind: "estate-tax", hidden: true, collapsed: false },
            { instanceId: "33333333-3333-4333-8333-333333333333", kind: "monte-carlo", hidden: false, collapsed: true },
          ],
        },
      },
    ]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.version).toBe(3);
    expect(layout.yearRange).toEqual({ start: 2030, end: 2055 });
    expect(layout.items.map((i) => i.kind)).toEqual(["portfolio", "monte-carlo"]);
    expect("collapsed" in layout.items[1]).toBe(false);
  });

  it("loads a v3 layout straight through", async () => {
    mockSelect([
      {
        layout: {
          version: 3,
          yearRange: { start: 2030, end: 2055 },
          items: [],
        },
      },
    ]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.version).toBe(3);
    expect(layout.yearRange).toEqual({ start: 2030, end: 2055 });
  });

  it("falls back to default when the saved layout fails Zod parse", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSelect([{ layout: { version: 1, items: [{ kind: "not-a-real-kind" }] } }]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.items.length).toBe(11);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
