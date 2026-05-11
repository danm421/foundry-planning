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
  // Drizzle: db.select().from(x).where(...)
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from });
}

describe("loadLayout", () => {
  it("returns the default layout when no row exists", async () => {
    mockSelect([]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.version).toBe(1);
    expect(layout.items.length).toBe(8);
  });

  it("returns the parsed layout when a valid row exists", async () => {
    mockSelect([
      {
        layout: {
          version: 1,
          items: [
            { instanceId: "11111111-1111-4111-8111-111111111111", kind: "portfolio" },
          ],
        },
      },
    ]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.items.length).toBe(1);
    expect(layout.items[0].kind).toBe("portfolio");
  });

  it("falls back to default when the saved layout fails Zod parse", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSelect([{ layout: { version: 1, items: [{ kind: "not-a-real-kind" }] } }]);
    const layout = await loadLayout("client-1", "firm-1");
    expect(layout.items.length).toBe(8);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
