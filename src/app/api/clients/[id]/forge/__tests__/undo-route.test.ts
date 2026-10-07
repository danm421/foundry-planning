// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror the resume-route test's mock surface — the undo route shares the same
// gate chain + both IDOR pins. undoToCheckpoint stays REAL so it exercises the
// fake graph's updateState.

const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));

const requireOrgId = vi.fn<() => Promise<string>>();
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: () => requireOrgId(),
  UnauthorizedError: class extends Error {},
}));

const requireActiveSubscription = vi.fn(async () => {});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: () => requireActiveSubscription() };
});

const verifyClientAccess = vi.fn<() => Promise<{ ok: boolean; permission?: string; firmId?: string; access?: string }>>();
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: () => verifyClientAccess() }));

const checkForgeRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkForgeRateLimit: () => checkForgeRateLimit() };
});

const findOwnedConversation = vi.fn<(...a: unknown[]) => Promise<{ clientId: string | null } | null>>();
vi.mock("@/domain/forge/conversations", () => ({
  findOwnedConversation: (...a: unknown[]) => findOwnedConversation(...a),
}));

const recordAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...(a as [])) }));

const getTuple = vi.fn(async () => ({
  checkpoint: {
    channel_values: {
      authContext: { userId: "user_1", firmId: "firm_1", clientId: "c1", scenarioId: "scenario_orig" },
    },
  },
}));
vi.mock("@/domain/forge/checkpointer", () => ({
  getCheckpointer: () => ({ getTuple: (...a: unknown[]) => getTuple(...(a as [])) }),
}));

const buildGraphCalls: unknown[][] = [];
const updateState = vi.fn(async () => ({}));
const fakeGraph = { updateState: (...a: unknown[]) => updateState(...(a as [])) };
const buildGraph = vi.fn((...args: unknown[]) => {
  buildGraphCalls.push(args);
  return fakeGraph;
});
vi.mock("@/domain/forge/graph", () => ({ buildGraph: (...a: unknown[]) => buildGraph(...a) }));

import { POST } from "../undo/route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/clients/c1/forge/undo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };
const goodBody = { conversationId: "conv-1", checkpointId: "ckpt-9" };

beforeEach(() => {
  vi.clearAllMocks();
  buildGraphCalls.length = 0;
  getTuple.mockResolvedValue({
    checkpoint: {
      channel_values: {
        authContext: { userId: "user_1", firmId: "firm_1", clientId: "c1", scenarioId: "scenario_orig" },
      },
    },
  });
  process.env.FORGE_ENABLED = "true";
  auth.mockResolvedValue({
    userId: "user_1",
    sessionClaims: { org_public_metadata: { entitlements: ["ai_copilot"], subscription_status: "active" } },
  });
  requireOrgId.mockResolvedValue("firm_1");
  requireActiveSubscription.mockResolvedValue(undefined);
  verifyClientAccess.mockResolvedValue({ ok: true, permission: "edit", firmId: "firm_1", access: "own" });
  checkForgeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, reset: 0 });
  findOwnedConversation.mockResolvedValue({ clientId: "c1" });
});

describe("POST /api/clients/[id]/forge/undo — gates + IDOR", () => {
  it("returns 404 when FORGE_ENABLED is off — buildGraph NOT called", async () => {
    process.env.FORGE_ENABLED = "false";
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 404 unless the thread is the caller's own in the active firm (IDOR) — buildGraph NOT called", async () => {
    // Another user's thread, or the caller's own from another firm: the lookup
    // scoped to (user, active firm) finds nothing.
    findOwnedConversation.mockResolvedValue(null);
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
    expect(findOwnedConversation).toHaveBeenCalledWith("conv-1", "user_1", "firm_1");
  });

  it("returns 404 on client-pin mismatch — buildGraph NOT called", async () => {
    getTuple.mockResolvedValue({
      checkpoint: {
        channel_values: {
          authContext: { userId: "user_1", firmId: "firm_1", clientId: "OTHER", scenarioId: "scenario_orig" },
        },
      },
    });
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 400 when checkpointId is missing", async () => {
    const res = await POST(makeReq({ conversationId: "conv-1" }), ctx);
    expect(res.status).toBe(400);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("reverts to the checkpoint (200) and audits the undo", async () => {
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(200);
    expect(updateState).toHaveBeenCalledWith(
      { configurable: { thread_id: "conv-1", checkpoint_id: "ckpt-9" } },
      { authContext: { userId: "user_1", firmId: "firm_1", clientId: "c1", scenarioId: "scenario_orig" } },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.undo", resourceId: "conv-1", metadata: { checkpointId: "ckpt-9" } }),
    );
  });
});
