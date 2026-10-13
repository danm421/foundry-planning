import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { clients } from "@/db/schema";

const db = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), where: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: db.select } }));

import { loadHouseholdBrand } from "../household-brand";

function seed(rows: unknown[]) {
  db.select.mockReturnValue({ from: db.from });
  db.from.mockReturnValue({ where: db.where });
  db.where.mockResolvedValue(rows);
}

describe("loadHouseholdBrand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the household's brand, scoped by client AND firm", async () => {
    seed([{ advisorId: "user_bob", brand: "firm" }]);
    expect(await loadHouseholdBrand("c1", "org_a")).toBe("firm");
    expect(db.select).toHaveBeenCalledWith({ advisorId: clients.advisorId, brand: clients.brand });
    expect(db.where).toHaveBeenCalledWith(and(eq(clients.id, "c1"), eq(clients.firmId, "org_a")));
  });

  it("falls back to the advisor, then to the firm brand when there is no row", async () => {
    seed([{ advisorId: "user_bob", brand: null }]);
    expect(await loadHouseholdBrand("c1", "org_a")).toBe("user_bob");
    seed([]);
    expect(await loadHouseholdBrand("c1", "org_a")).toBe("firm");
  });
});
