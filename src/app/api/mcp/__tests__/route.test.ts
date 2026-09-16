import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted, not a bare top-level const: these factories run during ESM
// import evaluation, before this file's own top-level statements — see
// define-tool.test.ts for the same pattern already established in this repo.
const { resolveMcpPrincipal, McpUnauthorizedError, MCP_RESOURCE_URL } = vi.hoisted(() => {
  class FakeMcpUnauthorizedError extends Error {
    constructor(reason: string) {
      super(reason);
      this.name = "McpUnauthorizedError";
    }
  }
  return {
    resolveMcpPrincipal: vi.fn(),
    McpUnauthorizedError: FakeMcpUnauthorizedError,
    // F5 (Task 12 fix round 1): route.ts now imports this constant from
    // `@/lib/mcp/principal` rather than defining its own copy, so this
    // file's mock of that module must supply it too.
    MCP_RESOURCE_URL: "https://app.foundryplanning.com/api/mcp",
  };
});
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const { decodeJwt } = vi.hoisted(() => ({ decodeJwt: vi.fn() }));

vi.mock("@/lib/mcp/principal", () => ({ resolveMcpPrincipal, McpUnauthorizedError, MCP_RESOURCE_URL }));
vi.mock("@/lib/audit", () => ({ recordAudit }));
// route.ts's own `decodeJwt` call, mocked so audience tests don't need a real
// signed JWT — safe in isolation here because resolveMcpPrincipal (the only
// other jose consumer on this path) is itself mocked above, so principal.ts's
// real jwtVerify/createRemoteJWKSet code never runs in this file.
vi.mock("jose", () => ({ decodeJwt }));

import {
  audienceIsAcceptable,
  toolFailureResult,
  recordDenial,
  requestedClientIdFrom,
  verifyToken,
} from "../route";
import { McpRateLimitedError, type McpTool } from "@/domain/mcp/define-tool";
import { McpForbiddenError, CLIENT_UNREADABLE_MESSAGE } from "@/domain/mcp/guards";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = {
  userId: "user_1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "user_1",
};

const fakeTool = { name: "test_tool" } as McpTool;

beforeEach(() => {
  resolveMcpPrincipal.mockReset();
  recordAudit.mockReset().mockResolvedValue(undefined);
  decodeJwt.mockReset();
});

describe("audienceIsAcceptable (D4)", () => {
  it("accepts an absent aud claim — aud_claim_enabled is off in prod today", () => {
    expect(audienceIsAcceptable(undefined, MCP_RESOURCE_URL)).toBe(true);
  });

  it("accepts a single aud that names this resource", () => {
    expect(audienceIsAcceptable(MCP_RESOURCE_URL, MCP_RESOURCE_URL)).toBe(true);
  });

  it("rejects a single aud that names a different resource", () => {
    expect(audienceIsAcceptable("https://someone-elses-resource.example.com", MCP_RESOURCE_URL)).toBe(
      false,
    );
  });

  it("accepts a multi-value aud that includes this resource", () => {
    expect(audienceIsAcceptable(["https://other.example.com", MCP_RESOURCE_URL], MCP_RESOURCE_URL)).toBe(
      true,
    );
  });

  it("rejects a multi-value aud that omits this resource", () => {
    expect(audienceIsAcceptable(["https://other.example.com"], MCP_RESOURCE_URL)).toBe(false);
  });
});

describe("toolFailureResult (D5, F4, F6)", () => {
  it("does NOT pass through an arbitrary Error's message — F4's default-deny allowlist", () => {
    // The exact shape I1 named: a raw driver error (Postgres 22P02 for a
    // malformed clientId) is a plain Error with no hand-written, model-safe
    // message. Only McpRateLimitedError/McpForbiddenError may pass their
    // `.message` through; everything else gets the generic sentence.
    const out = toolFailureResult(
      new Error('invalid input syntax for type uuid: "not-a-uuid"'),
    );
    expect(out.content[0].text).toBe("Foundry could not complete that request.");
    expect(out.content[0].text).not.toContain("uuid");
    expect(out.content[0].text).not.toContain("syntax");
  });

  it("passes through McpRateLimitedError's 'exceeded' message — retry helps", () => {
    const out = toolFailureResult(new McpRateLimitedError("exceeded"));
    expect(out.content[0].text).toMatch(/wait a minute and retry/i);
  });

  it("passes through McpRateLimitedError's other-reason message — retry does not help", () => {
    const out = toolFailureResult(new McpRateLimitedError("unconfigured"));
    expect(out.content[0].text).toMatch(/temporarily unavailable/i);
    expect(out.content[0].text).not.toMatch(/wait a minute/i);
  });

  it("distinguishes 'redis_error' the same way as 'unconfigured' — both are server-side, not caller-side", () => {
    const exceeded = toolFailureResult(new McpRateLimitedError("exceeded"));
    const redisError = toolFailureResult(new McpRateLimitedError("redis_error"));
    expect(redisError.content[0].text).not.toBe(exceeded.content[0].text);
    expect(redisError.content[0].text).toMatch(/temporarily unavailable/i);
  });

  it("passes through McpForbiddenError's message unchanged", () => {
    const out = toolFailureResult(new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE));
    expect(out.content[0].text).toBe(CLIENT_UNREADABLE_MESSAGE);
    expect(out.isError).toBe(true);
  });

  it("falls back to a generic, model-safe message for a non-Error throw", () => {
    const out = toolFailureResult("boom");
    expect(out.content[0].text).toBe("Foundry could not complete that request.");
  });
});

describe("recordDenial (D6, F9)", () => {
  it("records a denial with a null clientId — never the id the caller was refused", async () => {
    await recordDenial(fakeTool, principal, new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE));
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "mcp.tool_call",
      resourceType: "mcp_tool",
      resourceId: "test_tool",
      clientId: null,
      firmId: "org_1",
      actorId: "user_1",
      actorKind: "advisor",
      metadata: { tool: "test_tool", outcome: "denied", reason: "forbidden" },
    });
  });

  it("labels a rate-limit denial with its specific reason, not just 'denied' (server-side fault, not 'exceeded')", async () => {
    // "unconfigured" is a rare server-side fault worth a trace (F9/R87) —
    // unlike "exceeded" below, this one still writes a row.
    await recordDenial(fakeTool, principal, new McpRateLimitedError("unconfigured"));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { tool: "test_tool", outcome: "denied", reason: "rate_limited:unconfigured" },
      }),
    );
  });

  it("F9 (Ruling R87): skips the audit row entirely for a plain 'exceeded' rate-limit refusal", async () => {
    await recordDenial(fakeTool, principal, new McpRateLimitedError("exceeded"));
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("labels an unrecognized failure generically", async () => {
    await recordDenial(fakeTool, principal, new Error("db timeout"));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { tool: "test_tool", outcome: "denied", reason: "error" } }),
    );
  });

  // F7: D6's stated purpose is to make cross-firm PROBING visible, which a
  // null clientId on every denial row cannot show — an admin cannot tell a
  // fat-fingered id from someone sweeping ids across firms.
  it("F7: records the probed household id in metadata, never the typed clientId column", async () => {
    await recordDenial(
      fakeTool,
      principal,
      new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE),
      "22222222-2222-2222-2222-222222222222",
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: null,
        metadata: {
          tool: "test_tool",
          outcome: "denied",
          reason: "forbidden",
          requestedClientId: "22222222-2222-2222-2222-222222222222",
        },
      }),
    );
  });

  it("F7: a malformed (non-uuid) probed id lands in metadata as plain text and does not throw", async () => {
    await expect(
      recordDenial(fakeTool, principal, new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE), "not-a-uuid"),
    ).resolves.toBeUndefined();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ requestedClientId: "not-a-uuid" }),
      }),
    );
  });

  it("F7: truncates an overlong probed id to a sane length", async () => {
    const huge = "x".repeat(500);
    await recordDenial(fakeTool, principal, new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE), huge);
    const metadata = recordAudit.mock.calls[0][0].metadata as { requestedClientId: string };
    expect(metadata.requestedClientId.length).toBe(200);
  });

  it("F7: omits requestedClientId entirely when the call carried no clientId", async () => {
    await recordDenial(fakeTool, principal, new McpForbiddenError(CLIENT_UNREADABLE_MESSAGE), null);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { tool: "test_tool", outcome: "denied", reason: "forbidden" },
      }),
    );
  });
});

describe("requestedClientIdFrom (F7)", () => {
  it("reads a string clientId off the raw args", () => {
    expect(requestedClientIdFrom({ clientId: "c1" })).toBe("c1");
  });

  it("returns null when clientId is absent", () => {
    expect(requestedClientIdFrom({})).toBeNull();
  });

  it("returns null for non-object args, never throwing", () => {
    expect(requestedClientIdFrom(null)).toBeNull();
    expect(requestedClientIdFrom(undefined)).toBeNull();
    expect(requestedClientIdFrom("just a string")).toBeNull();
  });

  it("returns null when clientId is present but not a string", () => {
    expect(requestedClientIdFrom({ clientId: 12345 })).toBeNull();
  });
});

describe("verifyToken (D2, D4)", () => {
  it("returns undefined with no bearer token and never calls the verifier", async () => {
    const out = await verifyToken(new Request("https://x.test"), undefined);
    expect(out).toBeUndefined();
    expect(resolveMcpPrincipal).not.toHaveBeenCalled();
  });

  it("calls resolveMcpPrincipal with the bearer token alone (D2 — no request object)", async () => {
    resolveMcpPrincipal.mockResolvedValue(principal);
    decodeJwt.mockReturnValue({});
    await verifyToken(new Request("https://x.test"), "tok123");
    expect(resolveMcpPrincipal).toHaveBeenCalledWith("tok123");
    expect(resolveMcpPrincipal).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when resolveMcpPrincipal rejects with McpUnauthorizedError", async () => {
    resolveMcpPrincipal.mockRejectedValue(new McpUnauthorizedError("token failed verification"));
    const out = await verifyToken(new Request("https://x.test"), "bad.token");
    expect(out).toBeUndefined();
  });

  it("rethrows a non-McpUnauthorizedError instead of collapsing it into a silent rejection", async () => {
    resolveMcpPrincipal.mockRejectedValue(new Error("Clerk org membership API is down"));
    await expect(verifyToken(new Request("https://x.test"), "tok")).rejects.toThrow(
      "Clerk org membership API is down",
    );
  });

  it("accepts a token whose aud claim is absent", async () => {
    resolveMcpPrincipal.mockResolvedValue(principal);
    decodeJwt.mockReturnValue({});
    const out = await verifyToken(new Request("https://x.test"), "tok");
    expect(out).toEqual({ token: "tok", clientId: "user_1", scopes: [], extra: { principal } });
  });

  it("accepts a token whose aud claim names this resource", async () => {
    resolveMcpPrincipal.mockResolvedValue(principal);
    decodeJwt.mockReturnValue({ aud: MCP_RESOURCE_URL });
    const out = await verifyToken(new Request("https://x.test"), "tok");
    expect(out?.clientId).toBe("user_1");
  });

  it("rejects a token whose aud claim names a different resource", async () => {
    resolveMcpPrincipal.mockResolvedValue(principal);
    decodeJwt.mockReturnValue({ aud: "https://not-us.example.com" });
    const out = await verifyToken(new Request("https://x.test"), "tok");
    expect(out).toBeUndefined();
  });

  it("carries the principal through AuthInfo.extra for the tool-call callback to read", async () => {
    resolveMcpPrincipal.mockResolvedValue(principal);
    decodeJwt.mockReturnValue({});
    const out = await verifyToken(new Request("https://x.test"), "tok");
    expect(out?.extra?.principal).toBe(principal);
  });
});
