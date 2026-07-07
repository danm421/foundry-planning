import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  claim: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  markDone: vi.fn(),
  markFailed: vi.fn(),
  finalize: vi.fn(),
  markRunning: vi.fn(),
  audit: vi.fn(),
}));

// db.transaction(cb) -> cb receives a tx whose select/update chain returns m.claim()
vi.mock("@/db", () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ for: () => m.claim() }) }) }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => undefined }) }) }),
  };
  return { db: { transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } };
});
vi.mock("@/components/presentations/render-presentation-pdf", () => ({
  renderPresentationPdf: (...a: unknown[]) => m.render(...a),
}));
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: (...a: unknown[]) => m.save(...a) }));
vi.mock("@/lib/crm/generation-runs", () => ({
  markDone: (...a: unknown[]) => m.markDone(...a),
  markFailed: (...a: unknown[]) => m.markFailed(...a),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => m.audit(...a) }));
vi.mock("../batches", () => ({
  finalizeBatchIfComplete: (...a: unknown[]) => m.finalize(...a),
  markBatchRunning: (...a: unknown[]) => m.markRunning(...a),
}));

import { drainComplianceExports } from "../drain";

const run = (over: Record<string, unknown> = {}) => ({
  id: "run-1", clientId: "c1", firmId: "f1", scenarioId: "scn-1", batchId: "b1",
  triggeredBy: "user_1",
  requestPayload: { scenarioId: "scn-1", pages: [{ pageId: "clientProfile", options: {} }] },
  ...over,
});

beforeEach(() => {
  Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset?.());
  m.render.mockResolvedValue({ buffer: Buffer.from("pdf"), filename: "x.pdf" });
  m.save.mockResolvedValue({ id: "doc-1" });
});

// Helper: make the claim return one batch of runs, then empty.
function claimOnce(runs: unknown[]) {
  m.claim.mockResolvedValueOnce(runs).mockResolvedValue([]);
}

describe("drainComplianceExports", () => {
  it("renders, saves, marks done, and finalizes the batch", async () => {
    claimOnce([run()]);
    const res = await drainComplianceExports({ claimSize: 4 });
    expect(m.render).toHaveBeenCalledWith("c1", "f1", expect.objectContaining({ scenarioId: "scn-1" }));
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "c1", firmId: "f1", reportType: "compliance_export", scenarioId: "scn-1",
    }));
    expect(m.markDone).toHaveBeenCalledWith("run-1", "doc-1");
    expect(m.finalize).toHaveBeenCalledWith("b1");
    expect(res).toEqual({ processed: 1, done: 1, failed: 0 });
  });

  it("treats a null vault save as a failure", async () => {
    claimOnce([run()]);
    m.save.mockResolvedValue(null);
    const res = await drainComplianceExports({ claimSize: 4 });
    expect(m.markFailed).toHaveBeenCalledWith("run-1", expect.stringContaining("vault"));
    expect(m.markDone).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });

  it("isolates a render failure — other runs still succeed", async () => {
    claimOnce([run({ id: "run-bad", clientId: "cbad" }), run({ id: "run-ok", clientId: "cok" })]);
    m.render.mockImplementation((clientId: string) => {
      if (clientId === "cbad") throw new Error("projection blew up");
      return Promise.resolve({ buffer: Buffer.from("pdf"), filename: "x.pdf" });
    });
    const res = await drainComplianceExports({ claimSize: 4 });
    expect(m.markFailed).toHaveBeenCalledWith("run-bad", expect.stringContaining("projection"));
    expect(m.markDone).toHaveBeenCalledWith("run-ok", "doc-1");
    expect(res).toEqual({ processed: 2, done: 1, failed: 1 });
  });

  it("audits each saved doc with a system actor", async () => {
    claimOnce([run()]);
    await drainComplianceExports({ claimSize: 4 });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "system:compliance-export", actorKind: "system", clientId: "c1", firmId: "f1",
    }));
  });
});
