import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  households: vi.fn(),
  baseCase: vi.fn(),
  insertRun: vi.fn(),
  createBatch: vi.fn(),
  finalizeBatchIfComplete: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: { crmHouseholds: { findMany: (...a: unknown[]) => m.households(...a) } },
    // scenarios base-case lookup: select().from().where().limit()
    select: () => ({ from: () => ({ where: () => ({ limit: () => m.baseCase() }) }) }),
    // run insert: insert().values()
    insert: () => ({ values: (v: unknown) => m.insertRun(v) }),
  },
}));
vi.mock("../batches", () => ({
  createBatch: (...a: unknown[]) => m.createBatch(...a),
  finalizeBatchIfComplete: (...a: unknown[]) => m.finalizeBatchIfComplete(...a),
}));

import { enqueueFirmComplianceExport } from "../enqueue";

const NOW = new Date("2026-07-07T12:00:00Z");

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.insertRun.mockResolvedValue([{ id: "run-x" }]);
  m.createBatch.mockResolvedValue("batch-1");
  m.finalizeBatchIfComplete.mockResolvedValue(undefined);
});

describe("enqueueFirmComplianceExport", () => {
  it("enqueues renderable clients and records skips", async () => {
    m.households.mockResolvedValue([
      { id: "h1", name: "Smith", planningClient: { id: "c1" } },
      { id: "h2", name: "Jones", planningClient: null }, // prospect -> skip
      { id: "h3", name: "Nguyen", planningClient: { id: "c3" } },
    ]);
    // c1 has a base case; c3 does not
    m.baseCase
      .mockResolvedValueOnce([{ id: "scn-1" }])
      .mockResolvedValueOnce([]);

    const res = await enqueueFirmComplianceExport({
      firmId: "f1",
      triggeredBy: "user_1",
      triggeredByEmail: "a@b.co",
      now: NOW,
    });

    expect(res).toEqual({ batchId: "batch-1", total: 1, skipped: 2 });
    expect(m.insertRun).toHaveBeenCalledTimes(1);
    const runValues = m.insertRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runValues).toMatchObject({
      clientId: "c1",
      householdId: "h1",
      firmId: "f1",
      kind: "compliance_export",
      status: "queued",
      scenarioId: "scn-1",
    });
    const batchArg = m.createBatch.mock.calls[0][0] as { skippedClients: unknown[]; totalClients: number };
    expect(batchArg.totalClients).toBe(1);
    expect(batchArg.skippedClients).toEqual([
      { householdId: "h2", name: "Jones", reason: "no planning client" },
      { householdId: "h3", name: "Nguyen", reason: "no base-case scenario" },
    ]);
  });

  it("stamps batchId onto each enqueued run", async () => {
    m.households.mockResolvedValue([{ id: "h1", name: "Smith", planningClient: { id: "c1" } }]);
    m.baseCase.mockResolvedValueOnce([{ id: "scn-1" }]);
    await enqueueFirmComplianceExport({ firmId: "f1", triggeredBy: null, triggeredByEmail: null, now: NOW });
    const runValues = m.insertRun.mock.calls[0][0] as Record<string, unknown>;
    expect(runValues.batchId).toBe("batch-1");
  });

  it("finalizes the batch immediately when every household is skipped", async () => {
    m.households.mockResolvedValue([
      { id: "h1", name: "Smith", planningClient: null },
      { id: "h2", name: "Jones", planningClient: { id: "c2" } },
    ]);
    // c2 has no base-case scenario -> also skipped
    m.baseCase.mockResolvedValueOnce([]);

    const res = await enqueueFirmComplianceExport({
      firmId: "f1",
      triggeredBy: null,
      triggeredByEmail: null,
      now: NOW,
    });

    expect(res).toEqual({ batchId: "batch-1", total: 0, skipped: 2 });
    expect(m.insertRun).not.toHaveBeenCalled();
    expect(m.finalizeBatchIfComplete).toHaveBeenCalledTimes(1);
    expect(m.finalizeBatchIfComplete).toHaveBeenCalledWith("batch-1");
  });
});
