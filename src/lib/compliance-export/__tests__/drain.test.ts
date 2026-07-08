import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const m = vi.hoisted(() => ({
  claim: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  markDone: vi.fn(),
  markFailed: vi.fn(),
  finalize: vi.fn(),
  markRunning: vi.fn(),
  audit: vi.fn(),
  // reconcileStuckBatches runs top-level db.select (active batches) and one
  // guarded db.update (fails stale in-flight runs) per drain pass.
  dbSelectWhere: vi.fn(),
  dbUpdateWhere: vi.fn(),
}));

// db.transaction(cb) -> cb receives a tx whose select/update chain returns m.claim().
// Top-level db.select/db.update back the orphan-reconcile sweep. The update mock
// forwards both the WHERE arg and the SET payload so tests can inspect the real
// drizzle SQL object drain.ts builds (schema + drizzle-orm are real; only @/db is mocked).
vi.mock("@/db", () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ for: () => m.claim() }) }) }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => undefined }) }) }),
  };
  return {
    db: {
      transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
      select: () => ({ from: () => ({ where: () => m.dbSelectWhere() }) }),
      update: () => ({ set: (v: unknown) => ({ where: (w: unknown) => m.dbUpdateWhere(w, v) }) }),
    },
  };
});
vi.mock("@/components/presentations/render-presentation-pdf", () => ({
  renderPresentationPdf: (...a: unknown[]) => m.render(...a),
}));
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: (...a: unknown[]) => m.save(...a) }));
vi.mock("@/lib/crm/generation-runs", () => ({
  markDone: (...a: unknown[]) => m.markDone(...a),
  markFailed: (...a: unknown[]) => m.markFailed(...a),
  STALE_RUN_MS: 15 * 60 * 1000,
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
  // Reconcile finds nothing by default so it's inert in the happy-path tests.
  m.dbSelectWhere.mockResolvedValue([]);
  m.dbUpdateWhere.mockResolvedValue(undefined);
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
      metadata: expect.objectContaining({ pages: ["clientProfile"] }),
    }));
  });

  // Guards the permanent-409 hole: a batch's last child left `running` by a
  // crash is never re-claimed (claim only grabs `queued`), so without a sweep
  // the batch sits `running` forever and hasActiveBatchForFirm 409-blocks the
  // whole firm. The end-of-drain reconcile issues ONE guarded UPDATE (WHERE
  // carries kind + orphanable-status + startedAt-cutoff — no prior SELECT, so
  // there's no clobber window for a concurrent markDone), then finalizes any
  // active batch left with no in-flight children.
  it("reconciles orphaned batches: guarded-updates stale in-flight runs, then finalizes stuck batches", async () => {
    m.claim.mockResolvedValue([]); // no queued work — claim loop breaks immediately
    m.dbSelectWhere.mockResolvedValueOnce([{ id: "stuck-batch" }]); // active batch to settle
    const now = new Date("2026-07-07T12:00:00Z");
    const res = await drainComplianceExports({ claimSize: 4, now });
    expect(m.dbSelectWhere).toHaveBeenCalledTimes(1); // only the active-batches select remains
    expect(m.dbUpdateWhere).toHaveBeenCalledTimes(1); // the guarded fail-update fires every pass
    const [, setPayload] = m.dbUpdateWhere.mock.calls[0];
    expect(setPayload).toEqual({ status: "failed", error: "timed out", finishedAt: now });
    expect(m.finalize).toHaveBeenCalledWith("stuck-batch");
    expect(res).toEqual({ processed: 0, done: 0, failed: 0 });
  });

  // F1: the cutoff must key on startedAt (set by claimQueuedRuns when it flips
  // queued->running), not createdAt — a large batch drain can leave a
  // just-claimed run with a fresh startedAt but a createdAt already past the
  // 15-minute cutoff, which would wrongly fail it mid-render. F2: folding the
  // orphan check into this single UPDATE's WHERE (rather than a prior SELECT)
  // is what closes the clobber race — asserted here via the real WHERE shape.
  it("guards the fail-update's WHERE on startedAt (not createdAt), kind, and both in-flight statuses", async () => {
    m.claim.mockResolvedValue([]);
    // Non-empty so the update fires on both the old (orphan-select-gated) and
    // new (unconditional) shape — the discriminator below is the WHERE's SQL
    // text, not whether the update fired at all.
    m.dbSelectWhere.mockResolvedValueOnce([{ id: "irrelevant" }]);
    await drainComplianceExports({ claimSize: 4, now: new Date("2026-07-07T12:00:00Z") });
    expect(m.dbUpdateWhere).toHaveBeenCalledTimes(1);
    const [whereArg] = m.dbUpdateWhere.mock.calls[0];
    const { sql, params } = new PgDialect().sqlToQuery(whereArg as never);
    expect(sql).toContain("started_at");
    expect(sql).not.toContain("created_at");
    expect(params).toContain("compliance_export");
    expect(params).toContain("running");
    expect(params).toContain("analyzing");
  });

  it("finalize is still consulted for an active batch even though the fail-update is unconditional", async () => {
    m.claim.mockResolvedValue([]);
    m.dbSelectWhere.mockResolvedValueOnce([{ id: "b-live" }]); // a live batch still has queued work
    await drainComplianceExports({ claimSize: 4, now: new Date("2026-07-07T12:00:00Z") });
    // The fail-update is issued unconditionally now (guarded only by its WHERE,
    // which touches 0 rows here) — finalize is still called and no-ops itself.
    expect(m.dbUpdateWhere).toHaveBeenCalledTimes(1);
    expect(m.finalize).toHaveBeenCalledWith("b-live");
  });
});
