import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// vi.hoisted, not a bare top-level const: the factories below run during ESM
// import evaluation, which happens BEFORE this file's own top-level statements
// — a plain `const x = vi.fn()` referenced inside `vi.mock(..., () => ({ x }))`
// throws "Cannot access 'x' before initialization" (TDZ). vi.hoisted() runs
// ahead of the vi.mock calls themselves, so the references are initialized in
// time. Each factory still exports exactly one name, unchanged from the brief.
const { verifyClientAccessFor, recordAudit, checkMcpRateLimit } = vi.hoisted(() => ({
  verifyClientAccessFor: vi.fn(),
  recordAudit: vi.fn(),
  checkMcpRateLimit: vi.fn(),
}));

vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/rate-limit", () => ({ checkMcpRateLimit }));

import { defineTool, McpRateLimitedError } from "../define-tool";
import { McpForbiddenError } from "../guards";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = {
  userId: "user_1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "user_1",
};

beforeEach(() => {
  verifyClientAccessFor.mockReset().mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
  recordAudit.mockReset().mockResolvedValue(undefined);
  checkMcpRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 59, reset: 0 });
});

const tool = defineTool({
  name: "test_tool",
  title: "Test Tool",
  description: "A tool for tests.",
  inputSchema: z.object({ clientId: z.string() }),
  page: "overview",
  handler: async () => ({ secret: "ssn 123-45-6789", accountNumber: "12345678" }),
});

const noPageTool = defineTool({
  name: "no_page_tool",
  title: "No Page Tool",
  description: "A tool with no deep-link page.",
  inputSchema: z.object({ clientId: z.string() }),
  handler: async () => ({ ok: true }),
});

describe("defineTool", () => {
  it("sanitizes the handler's output", async () => {
    const out = await tool.run({ clientId: "c1" }, principal);
    expect(out).toMatchObject({
      secret: "ssn [REDACTED-SSN]",
      accountNumber: "••••5678",
    });
  });

  it("attaches a foundryUrl deep link", async () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://test.example.com";
    try {
      const out = (await tool.run({ clientId: "c1" }, principal)) as { foundryUrl: string };
      expect(out.foundryUrl).toBe("https://test.example.com/clients/c1/overview");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it("omits foundryUrl entirely when the tool defines no page", async () => {
    const out = await noPageTool.run({ clientId: "c1" }, principal);
    expect(out).not.toHaveProperty("foundryUrl");
  });

  it("records an audit row naming the tool", async () => {
    await tool.run({ clientId: "c1" }, principal);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mcp.tool_call",
        firmId: "org_1",
        clientId: "c1",
        actorId: "user_1",
        actorKind: "advisor",
        metadata: expect.objectContaining({ tool: "test_tool" }),
      }),
    );
  });

  it("refuses a client the principal cannot read", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false });
    await expect(tool.run({ clientId: "c1" }, principal)).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it("refuses a client owned by another firm, even when access resolves ok", async () => {
    verifyClientAccessFor.mockResolvedValue({
      ok: true,
      permission: "view",
      firmId: "org_OTHER",
      access: "shared",
    });
    await expect(tool.run({ clientId: "c1" }, principal)).rejects.toBeInstanceOf(McpForbiddenError);
  });

  it("never runs the handler when the rate limit denies", async () => {
    checkMcpRateLimit.mockResolvedValue({ allowed: false, reason: "exceeded" });
    await expect(tool.run({ clientId: "c1" }, principal)).rejects.toThrow(/rate limit/i);
    expect(verifyClientAccessFor).not.toHaveBeenCalled();
  });

  it("reports an unconfigured rate limiter as a service problem, not a wait-and-retry", async () => {
    checkMcpRateLimit.mockResolvedValue({ allowed: false, reason: "unconfigured" });
    let caught: unknown;
    try {
      await tool.run({ clientId: "c1" }, principal);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpRateLimitedError);
    expect((caught as McpRateLimitedError).reason).toBe("unconfigured");
    expect((caught as Error).message).not.toMatch(/wait a minute/i);
    expect((caught as Error).message).toMatch(/unavailable/i);
  });

  it("carries read-only annotations", () => {
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });
});
