import { describe, it, expect, vi, beforeEach } from "vitest";

const { createConversation, findOwnedConversation, getTuple } = vi.hoisted(() => ({
  createConversation: vi.fn(async () => "conv1"),
  findOwnedConversation: vi.fn<(...a: unknown[]) => Promise<{ clientId: string | null } | null>>(),
  getTuple: vi.fn<(...a: unknown[]) => Promise<unknown>>(),
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
  findOwnedConversation,
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
vi.mock("@/domain/forge/checkpointer", () => ({ getCheckpointer: vi.fn(() => ({ getTuple })) }));

import { POST } from "../route";
import { buildGraph } from "@/domain/forge/graph";

const post = (body: unknown) =>
  POST(new Request("http://t/api/forge/stream", { method: "POST", body: JSON.stringify(body) }));

describe("global forge stream route gate chain", () => {
  beforeEach(() => {
    createConversation.mockClear();
    vi.mocked(buildGraph).mockClear();
    findOwnedConversation.mockReset().mockResolvedValue({ clientId: null });
    // A global thread checkpointed by this caller.
    getTuple.mockReset().mockResolvedValue({
      checkpoint: { channel_values: { authContext: { userId: "user1", firmId: "firm1" } } },
    });
  });

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

  it("continues the caller's own global thread in the active firm", async () => {
    const res = await post({ message: "and the next step?", conversationId: "conv_g" });
    expect(res.status).toBe(200);
    expect(findOwnedConversation).toHaveBeenCalledWith("conv_g", "user1", "firm1");
    expect(createConversation).not.toHaveBeenCalled();
  });

  it("404s on the caller's own client thread, even before it has a checkpoint", async () => {
    findOwnedConversation.mockResolvedValue({ clientId: "client_X" });
    getTuple.mockResolvedValue(undefined);
    const res = await post({ message: "hi", conversationId: "conv_x" });
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("404s on the caller's own global thread from another firm", async () => {
    // Scoped to the active firm, the lookup finds no thread.
    findOwnedConversation.mockResolvedValue(null);
    const res = await post({ message: "hi", conversationId: "conv_other_firm" });
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });
});
