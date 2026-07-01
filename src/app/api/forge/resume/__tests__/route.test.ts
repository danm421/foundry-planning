// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock setup mirrors the client resume-route test + global stream-route test ---
// Every server-only-touching dep is mocked so the route module loads cleanly in
// the worktree (no `server-only` resolution issues).

// Flag module: mutable per-test via import.
vi.mock("@/domain/forge/flag", () => ({
  isForgeEnabled: vi.fn(() => true),
  hasForgeEntitlement: vi.fn(() => true),
}));

// Clerk auth.
const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => auth(),
  currentUser: () => Promise.resolve({ firstName: "Ada", lastName: "Advisor" }),
}));

// DB helpers.
const requireOrgId = vi.fn<() => Promise<string>>();
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: () => requireOrgId(),
  UnauthorizedError: class extends Error {},
}));

// requireActiveSubscription is MANDATORY — keep real authErrorResponse so errors
// map to the right HTTP status.
const requireActiveSubscription = vi.fn(async () => {});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: () => requireActiveSubscription() };
});

// Rate limit.
const checkForgeRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkForgeRateLimit: () => checkForgeRateLimit() };
});

// Conversations.
const touchConversation = vi.fn(async () => {});
const userOwnsConversation = vi.fn(async () => true);
vi.mock("@/domain/forge/conversations", () => ({
  touchConversation: (...a: unknown[]) => touchConversation(...(a as [])),
  userOwnsConversation: (...a: unknown[]) => userOwnsConversation(...(a as [])),
}));

// Audit.
const recordAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...(a as [])) }));

// Checkpointer: getTuple returns the persisted authContext (global-thread has NO clientId).
// Typed broadly (Record) so individual tests can inject a client-mode authContext for IDOR assertions.
const getTuple = vi.fn<() => Promise<{ checkpoint: { channel_values: { authContext: Record<string, unknown> } } } | undefined>>(async () => ({
  checkpoint: {
    channel_values: {
      authContext: {
        userId: "user_1",
        firmId: "firm_1",
        // No clientId — this is a GLOBAL thread.
      },
    },
  },
}));
vi.mock("@/domain/forge/checkpointer", () => ({
  getCheckpointer: () => ({ getTuple: (...a: unknown[]) => getTuple(...(a as [])) }),
}));

// Capture Command constructor args for assertion.
const commandArgs: unknown[] = [];
vi.mock("@langchain/langgraph", async () => {
  const actual = await vi.importActual<typeof import("@langchain/langgraph")>("@langchain/langgraph");
  return {
    ...actual,
    Command: class {
      constructor(arg: unknown) {
        commandArgs.push(arg);
      }
    },
  };
});

// buildGraph stub: captures calls, returns a fake graph.
const buildGraphCalls: unknown[][] = [];
const defaultStreamEvents = async function* () {
  yield { event: "on_chat_model_stream", data: { chunk: { content: "Hello" } }, name: "model" };
  yield { event: "on_chat_model_stream", data: { chunk: { content: " world." } }, name: "model" };
};
const fakeGraph: {
  streamEvents: (...a: unknown[]) => AsyncGenerator<unknown>;
  getState: ReturnType<typeof vi.fn>;
} = {
  streamEvents: defaultStreamEvents,
  getState: vi.fn(async () => ({ tasks: [] })),
};
const buildGraph = vi.fn((...args: unknown[]) => {
  buildGraphCalls.push(args);
  return fakeGraph;
});
vi.mock("@/domain/forge/graph", () => ({ buildGraph: (...a: unknown[]) => buildGraph(...a) }));

// Observability: no-ops.
vi.mock("@/domain/forge/observability", () => ({
  maybeLangfuseHandler: vi.fn(() => null),
  flushLangfuse: vi.fn(async () => {}),
}));

// Global system prompt.
vi.mock("@/domain/forge/global-system-prompt", () => ({
  buildGlobalSystemPrompt: vi.fn(() => "global system prompt"),
}));

// Interrupts.
vi.mock("@/domain/forge/interrupts", () => ({
  parseApprovalInterrupt: vi.fn((raw: unknown) => {
    const r = raw as { previews?: unknown[]; calls?: unknown[] };
    return { previews: r.previews ?? [], calls: r.calls ?? [] };
  }),
  parseMeetingReviewInterrupt: vi.fn(),
}));

import { POST } from "../route";

// Helper: build a POST Request with given JSON body.
function req(body: unknown): Request {
  return new Request("http://localhost/api/forge/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Drain SSE body into parsed event objects.
async function drainSse(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  return buf
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice("data: ".length)) as Record<string, unknown>);
}

const goodBody = {
  conversationId: "conv_1",
  decisions: { call_1: "confirm" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  buildGraphCalls.length = 0;
  commandArgs.length = 0;
  fakeGraph.streamEvents = defaultStreamEvents;
  fakeGraph.getState = vi.fn(async () => ({ tasks: [] }));

  // Default: global thread (no clientId in authContext).
  getTuple.mockResolvedValue({
    checkpoint: {
      channel_values: {
        authContext: { userId: "user_1", firmId: "firm_1" },
      },
    },
  });

  process.env.FORGE_ENABLED = "true";

  auth.mockResolvedValue({
    userId: "user_1",
    sessionClaims: {
      org_name: "Acme",
      org_public_metadata: {
        entitlements: ["ai_copilot"],
        subscription_status: "active",
      },
    },
  });
  requireOrgId.mockResolvedValue("firm_1");
  requireActiveSubscription.mockResolvedValue(undefined);
  checkForgeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, reset: 0 });
  userOwnsConversation.mockResolvedValue(true);
});

describe("POST /api/forge/resume — gate chain", () => {
  it("404s when FORGE_ENABLED is off", async () => {
    const { isForgeEnabled } = await import("@/domain/forge/flag");
    (isForgeEnabled as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const res = await POST(req(goodBody));
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("403s when forge entitlement is missing", async () => {
    const { hasForgeEntitlement } = await import("@/domain/forge/flag");
    (hasForgeEntitlement as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const res = await POST(req(goodBody));
    expect(res.status).toBe(403);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("400s when decisions is missing", async () => {
    const res = await POST(req({ conversationId: "conv_1" }));
    expect(res.status).toBe(400);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("400s when a decisions value is not confirm|reject", async () => {
    const res = await POST(req({ conversationId: "conv_1", decisions: { call_1: "banana" } }));
    expect(res.status).toBe(400);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("404s when userOwnsConversation returns false", async () => {
    userOwnsConversation.mockResolvedValue(false);
    const res = await POST(req(goodBody));
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("404s when the checkpointed thread is a CLIENT thread (has clientId) — IDOR pin", async () => {
    userOwnsConversation.mockResolvedValue(true);
    getTuple.mockResolvedValue({
      checkpoint: {
        channel_values: {
          authContext: {
            userId: "user_1",
            firmId: "firm_1",
            clientId: "c1",
            scenarioId: "base",
          },
        },
      },
    });
    const res = await POST(req({ conversationId: "conv_1", decisions: { call_1: "confirm" } }));
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("404s when the checkpointed userId does not match the resuming userId", async () => {
    userOwnsConversation.mockResolvedValue(true);
    getTuple.mockResolvedValue({
      checkpoint: {
        channel_values: {
          authContext: { userId: "OTHER_USER", firmId: "firm_1" },
        },
      },
    });
    const res = await POST(req(goodBody));
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("awaits requireActiveSubscription (mandatory gate runs)", async () => {
    await POST(req(goodBody));
    expect(requireActiveSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/forge/resume — happy path", () => {
  it("resumes with Command({resume:{decisions}}), streams token + done, touches, audits", async () => {
    const res = await POST(req(goodBody));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await drainSse(res);
    const types = events.map((e) => e.type);
    expect(types).toContain("token");
    expect(types).toContain("done");
    expect(events.find((e) => e.type === "token")).toMatchObject({ text: "Hello" });

    // Command constructed with the exact resume payload.
    expect(commandArgs).toHaveLength(1);
    expect(commandArgs[0]).toEqual({ resume: { decisions: goodBody.decisions } });

    // Conversation touched for the owner.
    expect(touchConversation).toHaveBeenCalledWith("conv_1", "user_1");

    // Route-level write_approved recorded (body has a confirm).
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        actorId: "user_1",
        firmId: "firm_1",
        metadata: expect.objectContaining({ confirmed: 1, rejected: 0, mode: "global" }),
      }),
    );
  });

  it("does NOT record route-level write_approved on an all-reject resume", async () => {
    const res = await POST(
      req({ conversationId: "conv_1", decisions: { call_1: "reject" as const } }),
    );
    expect(res.status).toBe(200);
    await drainSse(res);

    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });

  it("re-emits approval_required when getState reports a chained pending interrupt", async () => {
    fakeGraph.getState = vi.fn(async () => ({
      tasks: [
        {
          interrupts: [
            {
              value: {
                type: "approval_required",
                previews: [{ summary: "Create a note", name: "create_note" }],
                calls: [{ id: "t2", name: "create_note", args: {} }],
              },
            },
          ],
        },
      ],
    }));
    const res = await POST(req(goodBody));
    const events = await drainSse(res);
    const approval = events.find((e) => e.type === "approval_required");
    expect(approval).toBeDefined();
    expect(approval).toMatchObject({
      previews: [{ summary: "Create a note", name: "create_note" }],
    });
    // done still follows the chained approval.
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });
});
