// src/lib/audit/__tests__/snapshots/liability.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

import { db } from "@/db";
import { liabilities } from "@/db/schema";
import { toLiabilitySnapshot } from "../../snapshots/liability";

const row: typeof liabilities.$inferSelect = {
  id: "lia1",
  clientId: "cli1",
  scenarioId: "scn1",
  name: "Mortgage",
  balance: "300000.00",
  balanceAsOfMonth: 4,
  balanceAsOfYear: 2026,
  interestRate: "0.065",
  monthlyPayment: "1900.00",
  startYear: 2024,
  startMonth: 1,
  startYearRef: null,
  termMonths: 360,
  termUnit: "annual",
  linkedPropertyId: null,
  ownerEntityId: null,
  isInterestDeductible: true,
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

describe("toLiabilitySnapshot", () => {
  it("renders the row with numeric currency / percent fields", async () => {
    const snap = await toLiabilitySnapshot(row);
    expect(snap).toMatchObject({
      name: "Mortgage",
      balance: 300000,
      interestRate: 0.065,
      monthlyPayment: 1900,
      termMonths: 360,
      isInterestDeductible: true,
    });
    expect(snap).not.toHaveProperty("id");
  });

  it("hydrates linkedPropertyId to an account reference", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "acc1", name: "House" }]),
      }),
    } as never);

    const snap = await toLiabilitySnapshot({ ...row, linkedPropertyId: "acc1" });
    expect(snap.linkedProperty).toEqual({ id: "acc1", display: "House" });
  });
});
