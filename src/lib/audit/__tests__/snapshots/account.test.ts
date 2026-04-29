import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { toAccountSnapshot } from "../../snapshots/account";

const baseRow: typeof accounts.$inferSelect = {
  id: "acc1",
  clientId: "cli1",
  scenarioId: "scn1",
  name: "Joint Brokerage",
  category: "taxable",
  subType: "other",
  insuredPerson: null,
  value: "50000.00",
  basis: "30000.00",
  growthRate: "0.05",
  rmdEnabled: false,
  priorYearEndValue: null,
  isDefaultChecking: false,
  growthSource: "default",
  modelPortfolioId: null,
  turnoverPct: "0",
  overridePctOi: null,
  overridePctLtCg: null,
  overridePctQdiv: null,
  overridePctTaxExempt: null,
  annualPropertyTax: "0",
  propertyTaxGrowthRate: "0.03",
  source: "manual",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  } as never);
});

describe("toAccountSnapshot", () => {
  it("returns numeric scalars and drops system fields", async () => {
    const snap = await toAccountSnapshot(baseRow);

    expect(snap).toEqual({
      name: "Joint Brokerage",
      category: "taxable",
      subType: "other",
      value: 50000,
      basis: 30000,
      growthRate: 0.05,
      rmdEnabled: false,
      priorYearEndValue: null,
      isDefaultChecking: false,
      growthSource: "default",
      modelPortfolio: null,
      turnoverPct: 0,
      annualPropertyTax: 0,
      propertyTaxGrowthRate: 0.03,
      source: "manual",
    });
    expect(snap).not.toHaveProperty("id");
    expect(snap).not.toHaveProperty("createdAt");
    expect(snap).not.toHaveProperty("ownerEntityId");
    expect(snap).not.toHaveProperty("ownerEntity");
    expect(snap).not.toHaveProperty("ownerFamilyMember");
  });

  it("hydrates modelPortfolioId to a reference value", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "mp1", name: "Balanced Growth" },
        ]),
      }),
    } as never);

    const snap = await toAccountSnapshot({ ...baseRow, modelPortfolioId: "mp1" });

    expect(snap.modelPortfolio).toEqual({ id: "mp1", display: "Balanced Growth" });
  });

  it("falls back to deleted display when model portfolio cannot be resolved", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const snap = await toAccountSnapshot({
      ...baseRow,
      modelPortfolioId: "mp_missing",
    });

    expect(snap.modelPortfolio).toEqual({
      id: "mp_missing",
      display: "(deleted)",
    });
  });
});
