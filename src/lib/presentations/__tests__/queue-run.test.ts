// src/lib/presentations/__tests__/queue-run.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  afterTasks: [] as Array<() => unknown>,
  calls: [] as string[],
  createQueuedRun: vi.fn(),
  markAnalyzing: vi.fn(),
  markRunning: vi.fn(),
  markDone: vi.fn(),
  markFailed: vi.fn(),
  renderPresentationPdf: vi.fn(),
  savePlanToVault: vi.fn(),
  recordAudit: vi.fn(),
  unreviewedStoryChapters: vi.fn(),
  // The org each background step saw as the session-less AI caller, by step.
  scopes: {} as Record<string, string | undefined>,
}));

// A stand-in for withAiCallerOrg with a real async scope, so a test can read
// which org each background step ran under (resolve.test.ts covers the real one).
const aiCallerScope = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return new AsyncLocalStorage<string>();
});
vi.mock("@/lib/ai/resolve", () => ({
  withAiCallerOrg: (orgId: string, fn: () => unknown) => aiCallerScope.run(orgId, fn),
}));

// Capture after() so the test runs the background work when it chooses.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void h.afterTasks.push(fn) }));
vi.mock("@/lib/crm/generation-runs", () => ({
  createQueuedRun: h.createQueuedRun,
  markAnalyzing: h.markAnalyzing,
  markRunning: h.markRunning,
  markDone: h.markDone,
  markFailed: h.markFailed,
}));
vi.mock("@/lib/presentations/ensure-ai-summaries", () => {
  const pass = (name: string) => async (_clientId: string, _firmId: string, pages: unknown[]) => {
    h.calls.push(name);
    h.scopes[name] = aiCallerScope.getStore();
    return pages;
  };
  return {
    ensureRetirementComparisonAiSummaries: pass("ai:retirement"),
    ensureScenarioComparisonAiSummaries: pass("ai:scenario"),
    ensureInvestmentProposalAiSummaries: pass("ai:proposal"),
  };
});
vi.mock("@/components/presentations/render-presentation-pdf", () => ({
  renderPresentationPdf: h.renderPresentationPdf,
}));
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: h.savePlanToVault }));
vi.mock("@/lib/audit", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/presentations/story/export-gate", () => ({
  unreviewedStoryChapters: h.unreviewedStoryChapters,
}));

import { queuePresentationRun } from "../queue-run";
import type { ExportPdfBody } from "@/components/presentations/render-presentation-pdf";

const body = {
  scenarioId: null,
  preview: false,
  pages: [{ pageId: "cashFlow", options: {} }],
} as unknown as ExportPdfBody;

const args = {
  clientId: "c1",
  firmId: "org_1",
  householdId: "hh1",
  body,
  triggeredBy: "u1",
  triggeredByEmail: null,
  auditMetadata: {},
  via: "claude" as const,
};

const EIGHT_OF_TWELVE = { pageId: "planStory", scenarioId: "base", documentRole: "standalone", unreviewed: 8, total: 12 };

async function drainAfter() {
  for (const task of h.afterTasks.splice(0)) await task();
}

beforeEach(() => {
  h.afterTasks.length = 0;
  h.calls.length = 0;
  h.scopes = {};
  h.createQueuedRun.mockReset().mockResolvedValue("run1");
  h.markAnalyzing.mockReset().mockImplementation(async () => void h.calls.push("analyzing"));
  h.markRunning.mockReset().mockImplementation(async () => void h.calls.push("running"));
  h.markDone.mockReset().mockImplementation(async () => void h.calls.push("done"));
  h.markFailed.mockReset().mockResolvedValue(undefined);
  h.renderPresentationPdf.mockReset().mockImplementation(async () => {
    h.calls.push("render");
    h.scopes.render = aiCallerScope.getStore();
    return { buffer: Buffer.from("%PDF"), filename: "smith.pdf", clientLastName: "Smith", distinctScenarioCount: 1 };
  });
  h.savePlanToVault.mockReset().mockImplementation(async () => {
    h.calls.push("vault");
    return { id: "doc1" };
  });
  h.recordAudit.mockReset().mockImplementation(async (row: { action: string }) => void h.calls.push(`audit:${row.action}`));
  h.unreviewedStoryChapters.mockReset().mockResolvedValue([]);
});

describe("queuePresentationRun", () => {
  it("queues a run with the request and hands back its id and the story count, rendering nothing yet", async () => {
    h.unreviewedStoryChapters.mockResolvedValue([EIGHT_OF_TWELVE]);
    expect(await queuePresentationRun(args)).toEqual({ runId: "run1", storyReview: [EIGHT_OF_TWELVE] });
    expect(h.createQueuedRun).toHaveBeenCalledWith({
      clientId: "c1",
      householdId: "hh1",
      firmId: "org_1",
      kind: "presentation",
      scenarioId: null,
      triggeredBy: "u1",
      triggeredByEmail: null,
      requestPayload: body,
    });
    expect(h.calls).toEqual([]);
  });

  it("renders in the background in the app's order and audits as the named actor", async () => {
    await queuePresentationRun({ ...args, auditActorId: "u1" });
    await drainAfter();
    expect(h.calls).toEqual([
      "analyzing",
      "ai:retirement",
      "ai:scenario",
      "ai:proposal",
      "running",
      "render",
      "vault",
      "audit:presentations.export_pdf",
      "done",
    ]);
    expect(h.recordAudit).toHaveBeenCalledWith({
      action: "presentations.export_pdf",
      resourceType: "client",
      resourceId: "c1",
      clientId: "c1",
      firmId: "org_1",
      actorId: "u1",
      metadata: { pages: ["cashFlow"], via: "claude", brand: null },
    });
    expect(h.savePlanToVault).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", firmId: "org_1", reportType: "presentation", uploadedBy: "u1" }),
    );
    expect(h.markDone).toHaveBeenCalledWith("run1", "doc1");
  });

  it("leaves the actor to the session when none is named, keeping the caller's metadata", async () => {
    await queuePresentationRun({ ...args, via: "background-run", auditMetadata: { crossFirmActor: true } });
    await drainAfter();
    const row = h.recordAudit.mock.calls[0][0];
    expect(row).not.toHaveProperty("actorId");
    expect(row.metadata).toEqual({ crossFirmActor: true, pages: ["cashFlow"], via: "background-run", brand: null });
    // A web request's AI calls read the org from its session, as before.
    expect(h.scopes["ai:retirement"]).toBeUndefined();
  });

  it("runs the whole background render as the connector's verified org, so its AI commentary has a tenant", async () => {
    await queuePresentationRun({ ...args, auditActorId: "u1", aiCallerOrgId: "org_1" });
    await drainAfter();
    expect(h.scopes).toEqual({
      "ai:retirement": "org_1",
      "ai:scenario": "org_1",
      "ai:proposal": "org_1",
      render: "org_1",
    });
  });

  it("queues nothing in the background when a required run can't be created, and stays best-effort otherwise", async () => {
    h.createQueuedRun.mockResolvedValue(null);
    expect(await queuePresentationRun({ ...args, requireRun: true })).toEqual({ runId: null, storyReview: [] });
    expect(h.afterTasks).toHaveLength(0);
    await drainAfter();
    expect(h.renderPresentationPdf).not.toHaveBeenCalled();
    expect(h.savePlanToVault).not.toHaveBeenCalled();
    expect(h.recordAudit).not.toHaveBeenCalled();

    // The app's Generate button requires no run: the deck still renders and saves.
    expect(await queuePresentationRun(args)).toEqual({ runId: null, storyReview: [] });
    await drainAfter();
    expect(h.savePlanToVault).toHaveBeenCalledTimes(1);
  });

  it("records a run's scenario only when it is a scenario id — a snapshot deck still gets its run", async () => {
    const SCENARIO = "11111111-1111-4111-8111-111111111111";
    await queuePresentationRun({ ...args, body: { ...body, scenarioId: "snap:22222222-2222-4222-8222-222222222222" } });
    expect(h.createQueuedRun).toHaveBeenLastCalledWith(expect.objectContaining({ scenarioId: null }));
    await queuePresentationRun({ ...args, body: { ...body, scenarioId: SCENARIO } });
    expect(h.createQueuedRun).toHaveBeenLastCalledWith(expect.objectContaining({ scenarioId: SCENARIO }));
  });

  it("audits unreviewed story chapters after the deck lands, and never for a render that failed", async () => {
    h.unreviewedStoryChapters.mockResolvedValue([EIGHT_OF_TWELVE]);
    await queuePresentationRun({ ...args, auditActorId: "u1" });
    await drainAfter();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "plan_story.exported_unreviewed",
        actorId: "u1",
        metadata: expect.objectContaining({ pageId: "planStory", unreviewed: 8, total: 12 }),
      }),
    );

    h.recordAudit.mockClear();
    h.renderPresentationPdf.mockRejectedValueOnce(new Error("render blew up"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await queuePresentationRun(args);
    await drainAfter();
    errorSpy.mockRestore();
    expect(h.markFailed).toHaveBeenCalledWith("run1", "render blew up");
    expect(h.recordAudit).not.toHaveBeenCalled();
  });
});
