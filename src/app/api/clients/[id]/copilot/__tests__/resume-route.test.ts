// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mirror stream-route.test.ts's mock setup (the REAL route's full dep set) ---
// The resume route shares the stream route's gate chain, so the mock surface is
// the same — plus the checkpointer (read for the client-pin IDOR) and the
// graph/Command capture used to assert the rebuilt ctx + the resume value.

const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));

const requireOrgId = vi.fn<() => Promise<string>>();
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: () => requireOrgId(),
  UnauthorizedError: class extends Error {},
}));

// requireActiveSubscription is MANDATORY on this route (omitting it adds a
// failing entry to the active-subscription lint baseline). Mock it so we can
// assert the gate is awaited; authErrorResponse stays REAL so a throw maps
// to the right HTTP response.
const requireActiveSubscription = vi.fn(async () => {});
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscription: () => requireActiveSubscription() };
});

const verifyClientAccess = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: () => verifyClientAccess() }));

const checkForgeRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkForgeRateLimit: () => checkForgeRateLimit() };
});

const touchConversation = vi.fn(async () => {});
const userOwnsConversation = vi.fn(async () => true);
vi.mock("@/domain/forge/conversations", () => ({
  touchConversation: (...a: unknown[]) => touchConversation(...(a as [])),
  userOwnsConversation: (...a: unknown[]) => userOwnsConversation(...(a as [])),
}));

vi.mock("@/domain/forge/load-prompt-context", () => ({
  loadPromptContext: vi.fn(async () => ({
    firmName: "Northstar",
    client: { householdTitle: "Reyes Household" },
    scenario: { name: "Roth Ladder", isBaseCase: false },
  })),
}));

const recordAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...(a as [])) }));

// Checkpointer: getTuple returns the persisted authContext (the client-pin
// IDOR reads .clientId from here; the route recovers scenarioId from here too).
const getTuple = vi.fn(async () => ({
  checkpoint: {
    channel_values: {
      authContext: {
        userId: "user_1",
        firmId: "firm_1",
        clientId: "c1",
        scenarioId: "scenario_orig",
      },
    },
  },
}));
vi.mock("@/domain/forge/checkpointer", () => ({
  getCheckpointer: () => ({ getTuple: (...a: unknown[]) => getTuple(...(a as [])) }),
}));

// Capture Command's constructor arg to assert { resume: { decisions } }.
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

// buildGraph is 4-arg: (authContext, checkpointer, conversationId, systemPrompt).
// Capture every arg so we can assert the rebuilt ctx (esp. scenarioId).
const buildGraphCalls: unknown[][] = [];
const defaultStreamEvents = async function* () {
  yield { event: "on_chat_model_stream", data: { chunk: { content: "Applied" } }, name: "model" };
  yield { event: "on_chat_model_stream", data: { chunk: { content: " the change." } }, name: "model" };
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

import { POST } from "../resume/route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/clients/c1/copilot/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };

// Drain an SSE body into parsed event objects (split on \n\n, strip "data: ").
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

beforeEach(() => {
  vi.clearAllMocks();
  buildGraphCalls.length = 0;
  commandArgs.length = 0;
  fakeGraph.streamEvents = defaultStreamEvents;
  fakeGraph.getState = vi.fn(async () => ({ tasks: [] }));
  getTuple.mockResolvedValue({
    checkpoint: {
      channel_values: {
        authContext: {
          userId: "user_1",
          firmId: "firm_1",
          clientId: "c1",
          scenarioId: "scenario_orig",
        },
      },
    },
  });
  process.env.COPILOT_ENABLED = "true";
  auth.mockResolvedValue({
    userId: "user_1",
    sessionClaims: {
      org_public_metadata: { entitlements: ["ai_copilot"], subscription_status: "active" },
    },
  });
  requireOrgId.mockResolvedValue("firm_1");
  requireActiveSubscription.mockResolvedValue(undefined);
  verifyClientAccess.mockResolvedValue(true);
  checkForgeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, reset: 0 });
  userOwnsConversation.mockResolvedValue(true);
});

const goodBody = {
  conversationId: "conv-1",
  decisions: { t1: "confirm" as const },
};

describe("POST /api/clients/[id]/copilot/resume — gates + IDOR", () => {
  it("returns 404 when COPILOT_ENABLED is off", async () => {
    process.env.COPILOT_ENABLED = "false";
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 404 on user IDOR (userOwnsConversation=false) — buildGraph NOT called", async () => {
    userOwnsConversation.mockResolvedValue(false);
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 404 on client-pin mismatch (checkpointed clientId !== URL clientId) — buildGraph NOT called", async () => {
    getTuple.mockResolvedValue({
      checkpoint: {
        channel_values: {
          authContext: {
            userId: "user_1",
            firmId: "firm_1",
            clientId: "OTHER-CLIENT",
            scenarioId: "scenario_orig",
          },
        },
      },
    });
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 404 when the checkpoint is missing (no pending turn to resume)", async () => {
    getTuple.mockResolvedValue(undefined as never);
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 404 on user-pin mismatch (checkpointed userId !== resuming userId) — buildGraph NOT called", async () => {
    getTuple.mockResolvedValue({
      checkpoint: {
        channel_values: {
          authContext: {
            userId: "OTHER-USER",
            firmId: "firm_1",
            clientId: "c1",
            scenarioId: "scenario_orig",
          },
        },
      },
    });
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 400 when a decisions value is not confirm|reject — buildGraph NOT called", async () => {
    const res = await POST(
      makeReq({ conversationId: "conv-1", decisions: { call_1: "banana" } }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 404 when verifyClientAccess=false (cross-firm)", async () => {
    verifyClientAccess.mockResolvedValue(false);
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(404);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("awaits requireActiveSubscription (mandatory gate runs)", async () => {
    await POST(makeReq(goodBody), ctx);
    expect(requireActiveSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/clients/[id]/copilot/resume — happy path", () => {
  it("resumes with Command({resume:{decisions}}), streams token + done, touches, audits", async () => {
    const res = await POST(makeReq(goodBody), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await drainSse(res);
    const types = events.map((e) => e.type);
    expect(types).toContain("token");
    expect(types).toContain("done");
    expect(events.find((e) => e.type === "token")).toMatchObject({ text: "Applied" });

    // Command was constructed with the exact resume payload.
    expect(commandArgs).toHaveLength(1);
    expect(commandArgs[0]).toEqual({ resume: { decisions: goodBody.decisions } });

    // Conversation touched for the owner.
    expect(touchConversation).toHaveBeenCalledWith("conv-1", "user_1");

    // Conversation-level write_approved resume marker recorded (the body has a
    // confirm, so the route-level audit fires with the confirmed/rejected count).
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.write_approved",
        actorId: "user_1",
        clientId: "c1",
        firmId: "firm_1",
        metadata: expect.objectContaining({ confirmed: 1, rejected: 0 }),
      }),
    );
  });

  it("does NOT record route-level write_approved on an all-reject resume", async () => {
    const res = await POST(
      makeReq({ conversationId: "conv-1", decisions: { call_1: "reject" as const } }),
      ctx,
    );
    expect(res.status).toBe(200);
    // Drain so the stream lifecycle (touch/getState) completes.
    await drainSse(res);

    // No route-level copilot.write_approved row for a resume that confirmed
    // nothing. (The graph is mocked, so the per-write tool audit / write_rejected
    // node never fire here — this isolates the route-level audit.)
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "copilot.write_approved" }),
    );
  });

  it("rebuilds ctx from the CHECKPOINT, not a request default (scenarioId === checkpointed)", async () => {
    await POST(makeReq(goodBody), ctx);
    expect(buildGraph).toHaveBeenCalledTimes(1);
    const passedCtx = buildGraphCalls[0][0] as {
      userId: string;
      firmId: string;
      clientId: string;
      scenarioId: string;
    };
    // scenarioId comes from the persisted checkpoint, NOT a hard-coded "base".
    expect(passedCtx.scenarioId).toBe("scenario_orig");
    expect(passedCtx.clientId).toBe("c1");
    expect(passedCtx.firmId).toBe("firm_1");
    expect(passedCtx.userId).toBe("user_1");
  });

  it("re-emits approval_required when getState reports a chained pending interrupt", async () => {
    fakeGraph.getState = vi.fn(async () => ({
      tasks: [
        {
          interrupts: [
            {
              value: {
                previews: [{ summary: "Add Roth conversion", name: "propose_changes" }],
                calls: [{ id: "t2", name: "propose_changes", args: { scenarioId: "scenario_orig" } }],
              },
            },
          ],
        },
      ],
    }));
    const res = await POST(makeReq(goodBody), ctx);
    const events = await drainSse(res);
    const approval = events.find((e) => e.type === "approval_required");
    expect(approval).toBeDefined();
    expect(approval).toMatchObject({
      previews: [{ summary: "Add Roth conversion", name: "propose_changes" }],
    });
    // done still follows the chained approval.
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });
});
