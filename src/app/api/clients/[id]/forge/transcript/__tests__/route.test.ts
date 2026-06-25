// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Align mock shape to resume-route.test.ts (canonical forge route mock) ---

const auth = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => auth(),
}));

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

const verifyClientAccess = vi.fn<
  () => Promise<{ ok: boolean; permission?: string; firmId?: string; access?: string }>
>();
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: () => verifyClientAccess() }));

const clientToHousehold = vi.fn<() => Promise<string>>();
vi.mock("@/domain/forge/guards", () => ({
  clientToHousehold: (...a: unknown[]) => clientToHousehold(...(a as [])),
}));

vi.mock("@/domain/forge/flag", () => ({
  isForgeEnabled: () => true,
  hasForgeEntitlement: () => true,
}));

const checkForgeRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkForgeRateLimit: () => checkForgeRateLimit() };
});

const createMeetingTranscript = vi.fn<
  () => Promise<{ id: string; wordCount: number }>
>();
vi.mock("@/lib/forge/meeting-transcripts", () => ({
  createMeetingTranscript: (...a: unknown[]) => createMeetingTranscript(...(a as [])),
}));

import { POST } from "../route";

const GOOD_TEXT = "Advisor: ".concat("word ".repeat(300));
const params = Promise.resolve({ id: "client_1" });

function makeReq(body: unknown) {
  return new Request("http://x/api/clients/client_1/forge/transcript", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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
  clientToHousehold.mockResolvedValue("hh_1");
  createMeetingTranscript.mockResolvedValue({ id: "tr_1", wordCount: 120 });
});

describe("POST /forge/transcript — gates", () => {
  it("stashes a valid transcript and returns its id", async () => {
    const res = await POST(makeReq({ text: GOOD_TEXT }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transcriptId: "tr_1", wordCount: 120 });
    expect(createMeetingTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "client_1", householdId: "hh_1", firmId: "firm_1" }),
    );
  });

  it("400s on a too-short transcript", async () => {
    const res = await POST(makeReq({ text: "hi" }), { params });
    expect(res.status).toBe(400);
  });

  it("403s on view-only access", async () => {
    verifyClientAccess.mockResolvedValue({
      ok: true,
      permission: "view",
      firmId: "firm_1",
      access: "own",
    });
    const res = await POST(makeReq({ text: GOOD_TEXT }), { params });
    expect(res.status).toBe(403);
  });

  it("404s when verifyClientAccess returns ok=false (cross-firm)", async () => {
    verifyClientAccess.mockResolvedValue({ ok: false });
    const res = await POST(makeReq({ text: GOOD_TEXT }), { params });
    expect(res.status).toBe(404);
    expect(createMeetingTranscript).not.toHaveBeenCalled();
  });

  it("413s on an oversized transcript", async () => {
    const big = "a".repeat(500_001);
    const res = await POST(makeReq({ text: big }), { params });
    expect(res.status).toBe(413);
    expect(createMeetingTranscript).not.toHaveBeenCalled();
  });

  it("400s on invalid JSON body", async () => {
    const req = new Request("http://x/api/clients/client_1/forge/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req, { params });
    expect(res.status).toBe(400);
  });

  it("awaits requireActiveSubscription (mandatory gate runs)", async () => {
    await POST(makeReq({ text: GOOD_TEXT }), { params });
    expect(requireActiveSubscription).toHaveBeenCalledTimes(1);
  });

  it("passes source=explicit when body says so", async () => {
    await POST(makeReq({ text: GOOD_TEXT, source: "explicit" }), { params });
    expect(createMeetingTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ source: "explicit" }),
    );
  });

  it("defaults source to paste when omitted", async () => {
    await POST(makeReq({ text: GOOD_TEXT }), { params });
    expect(createMeetingTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ source: "paste" }),
    );
  });

  it("forwards conversationId when provided", async () => {
    await POST(makeReq({ text: GOOD_TEXT, conversationId: "conv_abc" }), { params });
    expect(createMeetingTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv_abc" }),
    );
  });
});
