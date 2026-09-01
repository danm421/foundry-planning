// src/lib/audit/__tests__/snapshots/liability.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({ db: { select: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { liabilities } from "@/db/schema";
import { recordUpdate } from "../../record-helpers";
import {
  toLiabilitySnapshot,
  LIABILITY_FIELD_LABELS,
} from "../../snapshots/liability";

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
  parentAccountId: null,
  isInterestDeductible: true,
  forgiveAtTermEnd: false,
  // Phase 2 columns — nullable
  liabilityType: null,
  minimumPayment: null,
  statementBalance: null,
  aprPercentage: null,
  nextPaymentDueDate: null,
  plaidItemId: null,
  plaidAccountId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.mocked(recordAudit).mockClear();
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

// Writing off a client's remaining balance is a compliance-relevant edit, so an
// update that touches ONLY that flag must still land in the audit log.
// `recordUpdate` returns early on zero changes, so the flag missing from the
// snapshot means the whole write silently disappears — this drives the real
// snapshot, the real label map and the real recordUpdate to catch that.
describe("auditing an update that flips only forgiveAtTermEnd", () => {
  it("writes one audit row carrying the readable label", async () => {
    const before = await toLiabilitySnapshot(row);
    const after = await toLiabilitySnapshot({ ...row, forgiveAtTermEnd: true });

    await recordUpdate({
      action: "liability.update",
      resourceType: "liability",
      resourceId: row.id,
      clientId: row.clientId,
      firmId: "firm1",
      before,
      after,
      fieldLabels: LIABILITY_FIELD_LABELS,
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const call = vi.mocked(recordAudit).mock.calls[0]![0];
    expect(call.metadata).toEqual({
      kind: "update",
      changes: [
        {
          field: "forgiveAtTermEnd",
          label: "Forgive balance at end of term",
          from: false,
          to: true,
          format: "text",
        },
      ],
    });
  });
});
