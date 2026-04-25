import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test", orgId: "firm_test" }),
}));

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: vi.fn().mockResolvedValue("firm_test"),
}));

vi.mock("@/lib/db-scoping", () => ({
  assertAccountsInClient: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { ...actual, recordDelete: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@/lib/audit/snapshots/transfer", () => ({
  toTransferSnapshot: vi.fn().mockResolvedValue({
    name: "Roth conversion",
    amount: 20000,
    sourceAccount: { id: "acc1", display: "Trad IRA" },
    targetAccount: { id: "acc2", display: "Roth IRA" },
  }),
  TRANSFER_FIELD_LABELS: {},
}));

const deleteCalls: unknown[] = [];

// db.select() is called 3 times: client (getBaseCaseScenarioId), scenario, transfer (existing).
// db.delete() is called once (the actual delete).
vi.mock("@/db", () => {
  let selectCallCount = 0;

  const existingTransfer = {
    id: "tr_test",
    name: "Roth conversion",
    amount: "20000",
    clientId: "cli_test",
  };

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // Client lookup in getBaseCaseScenarioId
          return [{ id: "cli_test", firmId: "firm_test" }];
        }
        if (selectCallCount === 2) {
          // Scenario lookup in getBaseCaseScenarioId
          return [{ id: "scn_test", clientId: "cli_test", isBaseCase: true }];
        }
        // Transfer existence check
        return [existingTransfer];
      }),
    })),
  }));

  const deleteOp = vi.fn(() => {
    deleteCalls.push("delete");
    return {
      where: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };
  });

  return {
    db: { select, delete: deleteOp },
  };
});

import { recordDelete } from "@/lib/audit";
import { DELETE } from "../route";

beforeEach(() => {
  deleteCalls.length = 0;
  vi.mocked(recordDelete).mockClear();
});

describe("DELETE /api/clients/[id]/transfers — audit shape", () => {
  it("calls recordDelete with snapshot captured before db.delete", async () => {
    const req = new Request(
      "http://localhost/api/clients/cli_test/transfers?transferId=tr_test",
      { method: "DELETE" },
    );
    const res = await DELETE(req as never, {
      params: Promise.resolve({ id: "cli_test" }),
    });

    expect(res.status).toBe(204);
    expect(recordDelete).toHaveBeenCalledTimes(1);
    expect(recordDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "transfer.delete",
        resourceType: "transfer",
        resourceId: "tr_test",
        clientId: "cli_test",
        firmId: "firm_test",
        snapshot: expect.objectContaining({
          name: "Roth conversion",
          amount: 20000,
          sourceAccount: { id: "acc1", display: "Trad IRA" },
        }),
      }),
    );
    // delete must have been called (the row was removed)
    expect(deleteCalls).toHaveLength(1);
  });
});
