// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mirror stream-tool-events.test.ts's mock setup (the REAL route's full dep set) ---

const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => auth() }));

const requireOrgId = vi.fn<() => Promise<string>>();
vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: () => requireOrgId(),
  UnauthorizedError: class extends Error {},
}));

const verifyClientAccess = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: () => verifyClientAccess() }));

const checkForgeRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkForgeRateLimit: () => checkForgeRateLimit() };
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

const fakeGraph: {
  streamEvents: (...a: unknown[]) => AsyncGenerator<unknown>;
  getState: ReturnType<typeof vi.fn>;
} = {
  streamEvents: async function* () {},
  getState: vi.fn(async () => ({ tasks: [] })),
};
vi.mock("@/domain/forge/graph", () => ({ buildGraph: () => fakeGraph }));

import { POST } from "../stream/route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/clients/c1/forge/stream", {
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
  fakeGraph.streamEvents = async function* () {};
  fakeGraph.getState = vi.fn(async () => ({ tasks: [] }));
  process.env.FORGE_ENABLED = "true";
  auth.mockResolvedValue({
    userId: "u1",
    sessionClaims: {
      org_public_metadata: { entitlements: ["ai_copilot"], subscription_status: "active" },
    },
  });
  requireOrgId.mockResolvedValue("org_A");
  verifyClientAccess.mockResolvedValue(true);
  checkForgeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, reset: 0 });
});

describe("POST /forge/stream — verification", () => {
  it("withholds the answer until verify passes, then flushes it", async () => {
    fakeGraph.streamEvents = async function* () {
      yield { event: "on_chat_model_stream", name: "model", data: { chunk: { content: "Balance is $1,000,000." } } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "start" } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "pass" } };
    };
    const res = await POST(makeReq({ message: "balance?", scenarioId: "base" }), ctx);
    const events = await drainSse(res);
    const types = events.map((e) => e.type);
    // No token before "verifying": the buffer was held.
    expect(types).toEqual(["conversation", "verifying", "token", "done"]);
    const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    expect(text).toBe("Balance is $1,000,000.");
  });

  it("prepends the caveat when verify exhausts", async () => {
    fakeGraph.streamEvents = async function* () {
      yield { event: "on_chat_model_stream", name: "model", data: { chunk: { content: "Balance is $2.5M." } } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "start" } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "caveat", caveat: "CHECK THESE." } };
    };
    const res = await POST(makeReq({ message: "balance?", scenarioId: "base" }), ctx);
    const events = await drainSse(res);
    const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    expect(text).toBe("CHECK THESE.\n\nBalance is $2.5M.");
  });

  it("discards the rejected draft on retry and streams only the revision", async () => {
    fakeGraph.streamEvents = async function* () {
      yield { event: "on_chat_model_stream", name: "model", data: { chunk: { content: "Draft says $1." } } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "start" } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "retry" } };
      yield { event: "on_chat_model_stream", name: "model", data: { chunk: { content: "Revised: $2." } } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "start" } };
      yield { event: "on_custom_event", name: "forge_verify", data: { result: "pass" } };
    };
    const res = await POST(makeReq({ message: "balance?", scenarioId: "base" }), ctx);
    const events = await drainSse(res);
    const text = events.filter((e) => e.type === "token").map((e) => e.text).join("");
    expect(text).toBe("Revised: $2.");
    expect(text).not.toContain("Draft");
  });
});
