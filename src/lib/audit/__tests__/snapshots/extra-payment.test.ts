// src/lib/audit/__tests__/snapshots/extra-payment.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));

import { db } from "@/db";
import { extraPayments } from "@/db/schema";
import { toExtraPaymentSnapshot } from "../../snapshots/extra-payment";

beforeEach(() => {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: "lia1", name: "Mortgage" }]),
    }),
  } as never);
});

describe("toExtraPaymentSnapshot", () => {
  it("returns numeric amount and resolved liability reference", async () => {
    const snap = await toExtraPaymentSnapshot({
      id: "ep1",
      liabilityId: "lia1",
      year: 2030,
      type: "lump_sum",
      amount: "5000.00",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof extraPayments.$inferSelect);

    expect(snap).toEqual({
      liability: { id: "lia1", display: "Mortgage" },
      year: 2030,
      type: "lump_sum",
      amount: 5000,
    });
  });
});
