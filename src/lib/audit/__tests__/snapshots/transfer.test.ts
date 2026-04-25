// src/lib/audit/__tests__/snapshots/transfer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

import { db } from "@/db";
import { transfers } from "@/db/schema";
import { toTransferSnapshot } from "../../snapshots/transfer";

const row: typeof transfers.$inferSelect = {
  id: "tr1",
  clientId: "cli1",
  scenarioId: "scn1",
  name: "Roth conversion",
  sourceAccountId: "acc1",
  targetAccountId: "acc2",
  amount: "20000.00",
  mode: "recurring",
  startYear: 2030,
  startYearRef: null,
  endYear: 2035,
  endYearRef: null,
  growthRate: "0",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([
        { id: "acc1", name: "Traditional IRA" },
        { id: "acc2", name: "Roth IRA" },
      ]),
    }),
  } as never);
});

describe("toTransferSnapshot", () => {
  it("hydrates source and target account references", async () => {
    const snap = await toTransferSnapshot(row);
    expect(snap.sourceAccount).toEqual({ id: "acc1", display: "Traditional IRA" });
    expect(snap.targetAccount).toEqual({ id: "acc2", display: "Roth IRA" });
    expect(snap.amount).toBe(20000);
    expect(snap.growthRate).toBe(0);
  });
});
