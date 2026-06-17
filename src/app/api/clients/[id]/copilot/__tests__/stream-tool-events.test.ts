// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mirror stream-route.test.ts's mock setup (the REAL route's full dep set) ---

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
vi.mock("@/domain/forge/conversations", () => ({
  createConversation: (...a: unknown[]) => createConversation(...(a as [])),
  touchConversation: (...a: unknown[]) => touchConversation(...(a as [])),
  userOwnsConversation: (...a: unknown[]) => userOwnsConversation(...(a as [])),
}));

vi.mock("@/domain/forge/load-prompt-context", () => ({
  loadPromptContext: vi.fn(async () => ({
    firmName: "Northstar",
    client: { householdTitle: "Reyes Household" },
    scenario: { name: "Base Case", isBaseCase: true },
  })),
}));

const recordAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...(a as [])) }));

vi.mock("@/domain/forge/checkpointer", () => ({ getCheckpointer: () => ({}) }));

// A tool-using v2 sequence: a token, then a tool start/end pair, then a token.
const toolStreamEvents = async function* () {
  yield {
    event: "on_chat_model_stream",
    name: "model",
    data: { chunk: { content: "Running" } },
  };
  yield { event: "on_tool_start", name: "run_monte_carlo", data: {} };
  yield { event: "on_tool_end", name: "run_monte_carlo", data: {} };
  yield {
    event: "on_chat_model_stream",
    name: "model",
    data: { chunk: { content: " — 84% PoS." } },
  };
};
const fakeGraph: {
  streamEvents: (...a: unknown[]) => AsyncGenerator<unknown>;
  getState: ReturnType<typeof vi.fn>;
} = {
  streamEvents: toolStreamEvents,
  getState: vi.fn(async () => ({ tasks: [] })),
};
vi.mock("@/domain/forge/graph", () => ({ buildGraph: () => fakeGraph }));

import { POST } from "../stream/route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/clients/c1/copilot/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "c1" }) };

// Drain an SSE body into parsed event objects (split on \n\n, strip "data: ", JSON.parse).
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
  fakeGraph.streamEvents = toolStreamEvents;
  fakeGraph.getState = vi.fn(async () => ({ tasks: [] }));
  process.env.COPILOT_ENABLED = "true";
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

describe("POST /api/clients/[id]/copilot/stream — tool events", () => {
  it("emits conversation, token, tool_start, tool_end, token, done in order", async () => {
    const res = await POST(
      makeReq({ message: "Run a Monte Carlo", scenarioId: "base" }),
      ctx,
    );
    expect(res.status).toBe(200);

    const events = await drainSse(res);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "conversation",
      "token",
      "tool_start",
      "tool_end",
      "token",
      "done",
    ]);

    expect(events[0].conversationId).toBe("conv-new");

    const toolStart = events.find((e) => e.type === "tool_start");
    const toolEnd = events.find((e) => e.type === "tool_end");
    expect(toolStart).toMatchObject({ name: "run_monte_carlo" });
    expect(toolEnd).toMatchObject({ name: "run_monte_carlo" });
  });

  it("returns 404 when COPILOT_ENABLED is off", async () => {
    process.env.COPILOT_ENABLED = "false";
    const res = await POST(makeReq({ message: "hi", scenarioId: "base" }), ctx);
    expect(res.status).toBe(404);
  });
});
