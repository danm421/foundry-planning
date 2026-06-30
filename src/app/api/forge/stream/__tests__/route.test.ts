import { describe, it, expect, vi, beforeEach } from "vitest";

const { createConversation } = vi.hoisted(() => ({
  createConversation: vi.fn(async () => "conv1"),
}));

vi.mock("@/domain/forge/flag", () => ({
  isForgeEnabled: vi.fn(() => true),
  hasForgeEntitlement: vi.fn(() => true),
}));
vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn(async () => "firm1") }));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscription: vi.fn(async () => {}),
  authErrorResponse: vi.fn(() => null),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user1", sessionClaims: { org_name: "Acme", org_public_metadata: { entitlements: ["forge"] } } })),
  currentUser: vi.fn(async () => ({ firstName: "Dana", lastName: "Lee" })),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkForgeRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitErrorResponse: vi.fn(() => new Response("rate", { status: 503 })),
}));
vi.mock("@/domain/forge/conversations", () => ({
  createConversation,
  touchConversation: vi.fn(async () => {}),
  userOwnsConversation: vi.fn(async () => true),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));
vi.mock("@/domain/forge/observability", () => ({
  maybeLangfuseHandler: vi.fn(() => null),
  flushLangfuse: vi.fn(async () => {}),
}));
// Minimal graph stub: a streamEvents async-iterable that emits one token + getState.
vi.mock("@/domain/forge/graph", () => ({
  buildGraph: vi.fn(() => ({
    async *streamEvents() {
      yield { event: "on_chat_model_stream", data: { chunk: { content: "Hi" } }, metadata: {} };
    },
    getState: async () => ({ tasks: [] }),
  })),
}));
vi.mock("@/domain/forge/checkpointer", () => ({ getCheckpointer: vi.fn(() => ({})) }));

import { POST } from "../route";

const post = (body: unknown) =>
  POST(new Request("http://t/api/forge/stream", { method: "POST", body: JSON.stringify(body) }));

describe("global forge stream route gate chain", () => {
  beforeEach(() => { createConversation.mockClear(); });

  it("404s when the flag is off", async () => {
    const { isForgeEnabled } = await import("@/domain/forge/flag");
    (isForgeEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    expect((await post({ message: "hi" })).status).toBe(404);
  });

  it("400s when message is missing", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("streams and creates a CLIENTLESS conversation", async () => {
    const res = await post({ message: "how do I add a household?" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // createConversation called WITHOUT a clientId
    const calls = createConversation.mock.calls as unknown as Array<[{ clientId?: string; firmId: string }]>;
    const arg = calls[0][0];
    expect(arg.clientId).toBeUndefined();
    expect(arg.firmId).toBe("firm1");
  });
});
