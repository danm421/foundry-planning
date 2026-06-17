// src/domain/copilot/tools/__tests__/report.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock every IO boundary so the tool stays a pure unit. ────────────────────
const requireOrgId = vi.fn();
const verifyClientAccess = vi.fn();
const createQueuedRun = vi.fn();
const markRunning = vi.fn();
const markDone = vi.fn();
const markFailed = vi.fn();
const renderPresentationPdf = vi.fn();
const savePlanToVault = vi.fn();
const recordAudit = vi.fn();

// db.select(...).from(...).where(...) → the client row (crmHouseholdId lookup).
const whereMock = vi.fn();
const fromMock = vi.fn(() => ({ where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: (...a: unknown[]) => requireOrgId(...a) }));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (...a: unknown[]) => verifyClientAccess(...a),
}));
vi.mock("@/db", () => ({ db: { select: () => selectMock() } }));
vi.mock("@/db/schema", () => ({ clients: { id: "id", firmId: "firmId", crmHouseholdId: "crmHouseholdId" } }));
vi.mock("@/lib/crm/generation-runs", () => ({
  createQueuedRun: (...a: unknown[]) => createQueuedRun(...a),
  markRunning: (...a: unknown[]) => markRunning(...a),
  markDone: (...a: unknown[]) => markDone(...a),
  markFailed: (...a: unknown[]) => markFailed(...a),
}));
vi.mock("@/components/presentations/render-presentation-pdf", () => ({
  renderPresentationPdf: (...a: unknown[]) => renderPresentationPdf(...a),
  // Passthrough — real schema validation isn't the unit under test here.
  BodySchema: { safeParse: (data: unknown) => ({ success: true, data }) },
}));
vi.mock("@/lib/crm/vault-plans", () => ({
  savePlanToVault: (...a: unknown[]) => savePlanToVault(...a),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));
// Run the after() callback inline and track its promise so tests can await the
// background job before asserting on render/persist side-effects.
let afterPromise: Promise<unknown> = Promise.resolve();
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    afterPromise = Promise.resolve(fn());
  },
}));

import { generateReport } from "../report";

const CTX = { userId: "u1", firmId: "firm-1", clientId: "client-1", scenarioId: "base" };

beforeEach(() => {
  vi.clearAllMocks();
  afterPromise = Promise.resolve();
  requireOrgId.mockResolvedValue("firm-1");
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "firm-1", access: "own" });
  whereMock.mockResolvedValue([{ crmHouseholdId: "hh1" }]);
  createQueuedRun.mockResolvedValue("run-1");
  renderPresentationPdf.mockResolvedValue({ buffer: Buffer.from("pdf"), filename: "deck.pdf" });
  savePlanToVault.mockResolvedValue({ id: "doc1" });
});

describe("generateReport", () => {
  it("validates pageIds, enqueues exactly one run, and returns the runId", async () => {
    const r = await generateReport({ pageIds: ["cover"] }, CTX, "conv-1");
    expect(r).toEqual({ runId: "run-1", status: "queued", pageCount: 1 });
    expect(createQueuedRun).toHaveBeenCalledTimes(1);
    // householdId comes from the client row, NOT ctx.clientId.
    expect(createQueuedRun).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-1", householdId: "hh1", firmId: "firm-1", kind: "presentation" }),
    );
  });

  it("runs the background job: markRunning → render → savePlanToVault → markDone(doc id)", async () => {
    await generateReport({ pageIds: ["cover"], title: "My Deck" }, CTX, "conv-1");
    await afterPromise;
    expect(markRunning).toHaveBeenCalledWith("run-1");
    expect(renderPresentationPdf).toHaveBeenCalledTimes(1);
    expect(savePlanToVault).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client-1", firmId: "firm-1", reportType: "presentation" }),
    );
    expect(markDone).toHaveBeenCalledWith("run-1", "doc1");
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("marks the run failed when the render throws", async () => {
    renderPresentationPdf.mockRejectedValueOnce(new Error("boom"));
    await generateReport({ pageIds: ["cover"] }, CTX, "conv-1");
    await afterPromise;
    expect(markFailed).toHaveBeenCalledWith("run-1", "boom");
    expect(markDone).not.toHaveBeenCalled();
  });

  it("rejects an unknown pageId (no run enqueued)", async () => {
    const r = await generateReport({ pageIds: ["cover", "notARealPage"] }, CTX, "conv-1");
    expect("error" in r && r.error).toMatch(/Unknown page/i);
    expect(createQueuedRun).not.toHaveBeenCalled();
  });

  it("rejects an empty pageIds list", async () => {
    const r = await generateReport({ pageIds: [] }, CTX, "conv-1");
    expect("error" in r).toBe(true);
    expect(createQueuedRun).not.toHaveBeenCalled();
  });

  it("rejects more than 6 distinct scenarios", async () => {
    const r = await generateReport(
      { pageIds: ["cover"], scenarioIds: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] },
      CTX,
      "conv-1",
    );
    expect("error" in r).toBe(true);
    expect(createQueuedRun).not.toHaveBeenCalled();
  });

  it("rejects more than 3 Monte Carlo scenarios", async () => {
    const r = await generateReport(
      { pageIds: ["monteCarlo"], scenarioIds: ["s1", "s2", "s3", "s4"] },
      CTX,
      "conv-1",
    );
    expect("error" in r).toBe(true);
    expect(createQueuedRun).not.toHaveBeenCalled();
  });

  it("refuses when the client has no CRM household", async () => {
    whereMock.mockResolvedValueOnce([{ crmHouseholdId: null }]);
    const r = await generateReport({ pageIds: ["cover"] }, CTX, "conv-1");
    expect("error" in r).toBe(true);
    expect(createQueuedRun).not.toHaveBeenCalled();
  });

  it("refuses when client access is denied", async () => {
    verifyClientAccess.mockResolvedValueOnce({ ok: false });
    const r = await generateReport({ pageIds: ["cover"] }, CTX, "conv-1");
    expect("error" in r).toBe(true);
    expect(createQueuedRun).not.toHaveBeenCalled();
  });

  it("returns an error when the run could not be queued", async () => {
    createQueuedRun.mockResolvedValueOnce(null);
    const r = await generateReport({ pageIds: ["cover"] }, CTX, "conv-1");
    expect("error" in r).toBe(true);
    // No background work fires without a runId.
    expect(markRunning).not.toHaveBeenCalled();
  });
});
