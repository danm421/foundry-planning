// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror the mock chain from resume-route.test.ts — same gate deps, same mock style.

const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => auth(),
  currentUser: () => Promise.resolve({ firstName: "Ada", lastName: "Advisor" }),
}));

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

const verifyClientAccess = vi.fn<
  () => Promise<{ ok: boolean; permission?: string; firmId?: string; access?: string }>
>();
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
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => recordAudit(...(a as [])),
}));

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

// Capture Command constructor arg to assert resume payload.
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

// buildGraph mock — same pattern as resume-route.test.ts.
const buildGraphCalls: unknown[][] = [];
const defaultStreamEvents = async function* () {
  yield { event: "on_chat_model_stream", data: { chunk: { content: "Done." } }, name: "model" };
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
vi.mock("@/domain/forge/graph", () => ({
  buildGraph: (...a: unknown[]) => buildGraph(...a),
}));

import { POST } from "../route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/clients/c1/forge/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };

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

const meetingReviewPayload = {
  approved: true,
  summaryTitle: "Q2 Review",
  summary: "Client wants to increase savings rate.",
  meetingDate: "2026-06-25",
  tasks: [
    {
      title: "Increase 401k contributions",
      description: "Move from 6% to 10%",
      priority: "high" as const,
      dueDate: "2026-07-01",
    },
  ],
};

const goodMeetingBody = {
  conversationId: "conv-1",
  meetingReview: meetingReviewPayload,
};

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
  process.env.FORGE_ENABLED = "true";
  auth.mockResolvedValue({
    userId: "user_1",
    sessionClaims: {
      org_public_metadata: { entitlements: ["ai_copilot"], subscription_status: "active" },
    },
  });
  requireOrgId.mockResolvedValue("firm_1");
  requireActiveSubscription.mockResolvedValue(undefined);
  verifyClientAccess.mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "firm_1",
    access: "own",
  });
  checkForgeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, reset: 0 });
  userOwnsConversation.mockResolvedValue(true);
});

describe("POST /api/clients/[id]/forge/resume — meetingReview path", () => {
  it("returns 200 + SSE stream for a meetingReview body", async () => {
    const res = await POST(makeReq(goodMeetingBody), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await drainSse(res);
    expect(events.map((e) => e.type)).toContain("done");
  });

  it("passes Command({ resume: meetingReview }) to graph.streamEvents", async () => {
    const res = await POST(makeReq(goodMeetingBody), ctx);
    await drainSse(res);
    // One Command was constructed.
    expect(commandArgs).toHaveLength(1);
    // The resume value is the meetingReview object verbatim.
    const arg = commandArgs[0] as { resume: { approved: boolean } };
    expect(arg.resume).toMatchObject({ approved: true, summaryTitle: "Q2 Review" });
    expect(arg.resume.approved).toBe(true);
  });

  it("does NOT fire the route-level forge.write_approved audit on the meeting path", async () => {
    const res = await POST(makeReq(goodMeetingBody), ctx);
    await drainSse(res);
    expect(recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "forge.write_approved" }),
    );
  });

  it("returns 400 when meetingReview.approved is not a boolean", async () => {
    const res = await POST(
      makeReq({
        conversationId: "conv-1",
        meetingReview: { ...meetingReviewPayload, approved: "yes" },
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("returns 400 when neither decisions nor meetingReview is provided", async () => {
    const res = await POST(makeReq({ conversationId: "conv-1" }), ctx);
    expect(res.status).toBe(400);
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("emits meeting_review event when a chained interrupt is of type meeting_review", async () => {
    fakeGraph.getState = vi.fn(async () => ({
      tasks: [
        {
          interrupts: [
            {
              value: {
                type: "meeting_review",
                summaryTitle: "Follow-up",
                summary: "Reviewed next steps.",
                meetingDate: "2026-07-01",
                proposedTasks: [],
              },
            },
          ],
        },
      ],
    }));
    const res = await POST(makeReq(goodMeetingBody), ctx);
    const events = await drainSse(res);
    const mr = events.find((e) => e.type === "meeting_review");
    expect(mr).toBeDefined();
    expect(mr).toMatchObject({ summaryTitle: "Follow-up", summary: "Reviewed next steps." });
    // done still follows the chained meeting_review.
    expect(events[events.length - 1]).toMatchObject({ type: "done" });
  });

  it("existing decisions path still works and fires route-level audit", async () => {
    const decisionsBody = { conversationId: "conv-1", decisions: { t1: "confirm" as const } };
    const res = await POST(makeReq(decisionsBody), ctx);
    expect(res.status).toBe(200);
    await drainSse(res);
    // Command receives { decisions } shape.
    expect(commandArgs).toHaveLength(1);
    expect(commandArgs[0]).toEqual({ resume: { decisions: { t1: "confirm" } } });
    // Route-level audit fires on the decisions path.
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "forge.write_approved",
        metadata: expect.objectContaining({ confirmed: 1, rejected: 0 }),
      }),
    );
  });
});
