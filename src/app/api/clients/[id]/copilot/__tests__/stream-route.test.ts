import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Clerk auth() seam (requireActiveSubscription runs REAL against this mock) ---
const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));

const requireOrgId = vi.fn<() => Promise<string>>();
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: () => requireOrgId(),
  UnauthorizedError: class extends Error {},
}));

const verifyClientAccess = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: () => verifyClientAccess() }));

const checkCopilotRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkCopilotRateLimit: () => checkCopilotRateLimit() };
});

const createConversation = vi.fn(async () => "conv-new");
const touchConversation = vi.fn(async () => {});
const userOwnsConversation = vi.fn(async () => true);
vi.mock("@/domain/copilot/conversations", () => ({
  createConversation: (...a: unknown[]) => createConversation(...(a as [])),
  touchConversation: (...a: unknown[]) => touchConversation(...(a as [])),
  userOwnsConversation: (...a: unknown[]) => userOwnsConversation(...(a as [])),
}));

vi.mock("@/domain/copilot/load-prompt-context", () => ({
  loadPromptContext: vi.fn(async () => ({
    firmName: "Northstar",
    client: { householdTitle: "Reyes Household" },
    scenario: { name: "Base Case", isBaseCase: true },
  })),
}));

const recordAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...(a as [])) }));

vi.mock("@/domain/copilot/checkpointer", () => ({ getCheckpointer: () => ({}) }));

// Default happy-path token stream. Restored in beforeEach so per-test overrides
// (e.g. the stream-side error case) don't leak across tests.
const defaultStreamEvents = async function* () {
  yield { event: "on_chat_model_stream", data: { chunk: { content: "Hello" } }, name: "model" };
  yield { event: "on_chat_model_stream", data: { chunk: { content: " there." } }, name: "model" };
};
const fakeGraph: {
  streamEvents: (...a: unknown[]) => AsyncGenerator<unknown>;
  getState: ReturnType<typeof vi.fn>;
} = {
  streamEvents: defaultStreamEvents,
  getState: vi.fn(async () => ({ tasks: [] })),
};
vi.mock("@/domain/copilot/graph", () => ({ buildGraph: () => fakeGraph }));

import { POST } from "../stream/route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/clients/c1/copilot/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };

async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeGraph.streamEvents = defaultStreamEvents;
  process.env.COPILOT_ENABLED = "true";
  // §B: subscription_status:"active" must live INSIDE org_public_metadata so the
  // REAL requireActiveSubscription passes and the happy path reaches the stream.
  auth.mockResolvedValue({
    userId: "u1",
    sessionClaims: {
      org_public_metadata: { entitlements: ["ai_copilot"], subscription_status: "active" },
    },
  });
  requireOrgId.mockResolvedValue("org_A");
  verifyClientAccess.mockResolvedValue(true);
  checkCopilotRateLimit.mockResolvedValue({ allowed: true, remaining: 9, reset: 0 });
});

describe("POST /api/clients/[id]/copilot/stream — gate chain", () => {
  it("returns 404 when the feature flag is off", async () => {
    process.env.COPILOT_ENABLED = "false";
    const res = await POST(makeReq({ message: "hi", scenarioId: "base" }), ctx);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the client belongs to another firm (cross-firm)", async () => {
    verifyClientAccess.mockResolvedValue(false);
    const res = await POST(makeReq({ message: "hi", scenarioId: "base" }), ctx);
    expect(res.status).toBe(404);
  });

  it("returns 429/503 when rate-limited", async () => {
    checkCopilotRateLimit.mockResolvedValue({ allowed: false, reason: "exceeded", reset: 0 });
    const res = await POST(makeReq({ message: "hi", scenarioId: "base" }), ctx);
    expect([429, 503]).toContain(res.status);
  });

  it("returns 403 when the ai_copilot entitlement is missing", async () => {
    // §B: keep subscription_status:"active" so requireActiveSubscription PASSES —
    // the entitlement gate is what must produce the 403.
    auth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { entitlements: [], subscription_status: "active" },
      },
    });
    const res = await POST(makeReq({ message: "hi", scenarioId: "base" }), ctx);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the subscription is inactive", async () => {
    // §B: caught at gate step 3 (requireActiveSubscription) BEFORE the entitlement
    // / client-access / rate-limit gates. No is_founder bypass.
    auth.mockResolvedValue({
      userId: "u1",
      sessionClaims: {
        org_public_metadata: { entitlements: ["ai_copilot"], subscription_status: "canceled" },
      },
    });
    const res = await POST(makeReq({ message: "hi", scenarioId: "base" }), ctx);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/clients/[id]/copilot/stream — hello stream", () => {
  it("streams conversation + tokens + done, and records the audit", async () => {
    const res = await POST(makeReq({ message: "Tell me about the plan", scenarioId: "base" }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const out = await drain(res);
    expect(out).toContain('"type":"conversation"');
    expect(out).toContain("conv-new");
    expect(out).toContain('"type":"token"');
    expect(out).toContain("Hello");
    expect(out).toContain("there.");
    expect(out).toContain('"type":"done"');

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(touchConversation).toHaveBeenCalledWith("conv-new", "u1");
  });

  it("returns 404 when the caller does not own the supplied conversationId (IDOR)", async () => {
    userOwnsConversation.mockResolvedValue(false);
    const res = await POST(
      makeReq({ message: "hi", scenarioId: "base", conversationId: "someone-elses" }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it("emits a generic SSE error (never raw internals) when the stream throws", async () => {
    // The stream surfaces graph failures as a mid-stream SSE error event — HTTP
    // status stays 200. The raw message (UUID + 'internal detail') must NOT leak;
    // only safeCopilotErrorMessage's generic fallback should reach the client.
    fakeGraph.streamEvents = async function* () {
      yield { event: "noop", data: {}, name: "model" };
      throw new Error("boom 1a2b3c4d-5e6f-7890-abcd-ef0123456789 internal detail");
    };
    const res = await POST(makeReq({ message: "hi", scenarioId: "base" }), ctx);
    expect(res.status).toBe(200);

    const out = await drain(res);
    expect(out).toContain('"type":"error"');
    expect(out).not.toContain("1a2b3c4d-5e6f-7890-abcd-ef0123456789");
    expect(out).not.toContain("internal detail");
  });

  it("returns 400 when the body is missing message (malformed body)", async () => {
    const res = await POST(makeReq({}), ctx);
    expect(res.status).toBe(400);
  });
});
