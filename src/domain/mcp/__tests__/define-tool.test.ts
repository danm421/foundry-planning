import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// vi.hoisted, not a bare top-level const: the factories below run during ESM
// import evaluation, which happens BEFORE this file's own top-level statements
// — a plain `const x = vi.fn()` referenced inside `vi.mock(..., () => ({ x }))`
// throws "Cannot access 'x' before initialization" (TDZ). vi.hoisted() runs
// ahead of the vi.mock calls themselves, so the references are initialized in
// time. Each factory still exports exactly one name, unchanged from the brief.
const { verifyClientAccessFor, recordAudit, checkMcpRateLimit, assertHouseholdReadable } = vi.hoisted(() => ({
  verifyClientAccessFor: vi.fn(),
  recordAudit: vi.fn(),
  checkMcpRateLimit: vi.fn(),
  assertHouseholdReadable: vi.fn(),
}));

vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit }));
vi.mock("@/lib/rate-limit", () => ({ checkMcpRateLimit }));
// Only `assertHouseholdReadableForPrincipal` is replaced — everything else
// (McpForbiddenError, CLIENT_UNREADABLE_MESSAGE, the real
// assertClientReadableForPrincipal that the clientId tests below exercise via
// the mocked verifyClientAccessFor) passes through untouched via
// importOriginal, so this mock only intercepts the new householdId path.
vi.mock("../guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../guards")>();
  return { ...actual, assertHouseholdReadableForPrincipal: assertHouseholdReadable };
});

import { defineTool, McpRateLimitedError } from "../define-tool";
import { McpForbiddenError, CLIENT_UNREADABLE_MESSAGE } from "../guards";
import type { McpPrincipal } from "@/lib/mcp/principal";
import type { McpToolContext } from "../context";

const principal: McpPrincipal = {
  userId: "user_1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "user_1",
};

// A real spy (not an inline arrow) so tests can assert exactly what
// defineTool hands the handler — args and ctx — and, separately, that a
// denied call never reaches it at all.
const handlerSpy = vi.fn<
  (args: { clientId: string }, ctx: McpToolContext) => Promise<{ secret: string; accountNumber: string }>
>();

const optionalClientHandlerSpy = vi.fn<() => Promise<{ ok: true }>>();

beforeEach(() => {
  verifyClientAccessFor.mockReset().mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
  recordAudit.mockReset().mockResolvedValue(undefined);
  checkMcpRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 59, reset: 0 });
  handlerSpy.mockReset().mockResolvedValue({ secret: "ssn 123-45-6789", accountNumber: "12345678" });
  optionalClientHandlerSpy.mockReset().mockResolvedValue({ ok: true });
  assertHouseholdReadable.mockReset();
});

const tool = defineTool({
  name: "test_tool",
  title: "Test Tool",
  description: "A tool for tests.",
  inputSchema: z.object({ clientId: z.string() }),
  page: "overview",
  handler: handlerSpy,
});

const noPageTool = defineTool({
  name: "no_page_tool",
  title: "No Page Tool",
  description: "A tool with no deep-link page.",
  inputSchema: z.object({ clientId: z.string() }),
  handler: async () => ({ ok: true }),
});

// clientId declared but OPTIONAL — exercises the schema-driven trigger from
// Important 2. Duck-typing the parsed value (the pre-fix approach) would
// silently skip the check here, since an omitted optional field parses to
// `undefined`, not a string.
const optionalClientIdTool = defineTool({
  name: "optional_client_tool",
  title: "Optional Client Tool",
  description: "Declares clientId as optional but must still be checked when declared.",
  inputSchema: z.object({ clientId: z.string().optional() }),
  handler: optionalClientHandlerSpy,
});

// Returns the array itself, not wrapped in an object — exercises the
// array-safety guard from Important 3. (Every real Task 8-11 tool wraps its
// list in an object; this fixture deliberately violates that convention to
// prove the wrapper still can't be corrupted by it.)
const arrayTool = defineTool({
  name: "array_tool",
  title: "Array Tool",
  description: "Returns a raw list.",
  inputSchema: z.object({ clientId: z.string() }),
  page: "overview",
  handler: async () => ["a", "b", "c"],
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

  it("returns an array result intact instead of corrupting it into an indexed object", async () => {
    const out = await arrayTool.run({ clientId: "c1" }, principal);
    expect(out).toEqual(["a", "b", "c"]);
  });

  it("passes the parsed args and a firm-scoped context to the handler — never a model-supplied scope", async () => {
    await tool.run({ clientId: "c1" }, principal);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    const [args, ctx] = handlerSpy.mock.calls[0]!;
    expect(args).toEqual({ clientId: "c1" });
    expect(ctx.firmId).toBe("org_1");
    expect(ctx.principal).toBe(principal);
    // The bucket key is firm + user: a firm's whole staff must not share one
    // budget, and one advisor's calls must not draw on a colleague's.
    expect(checkMcpRateLimit).toHaveBeenCalledWith("org_1:user_1");
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

  it("refuses a client the principal cannot read, even when firmId happens to match", async () => {
    // Isolates the `!access.ok` clause from the firm-match clause: firmId
    // matches the principal's org here, so only the `ok:false` check can be
    // the thing raising. Without it this would (wrongly) pass through.
    verifyClientAccessFor.mockResolvedValue({ ok: false, firmId: "org_1" });
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

  it("refuses when the schema declares clientId but none was supplied, and never reaches the handler", async () => {
    await expect(optionalClientIdTool.run({}, principal)).rejects.toBeInstanceOf(McpForbiddenError);
    expect(optionalClientHandlerSpy).not.toHaveBeenCalled();
    // Not run at all — the throw happens before the DB-backed authz check.
    expect(verifyClientAccessFor).not.toHaveBeenCalled();
  });

  it("never runs the handler when the rate limit denies", async () => {
    checkMcpRateLimit.mockResolvedValue({ allowed: false, reason: "exceeded" });
    await expect(tool.run({ clientId: "c1" }, principal)).rejects.toThrow(/rate limit/i);
    // The direct claim the test name makes...
    expect(handlerSpy).not.toHaveBeenCalled();
    // ...and the ordering invariant ("rate limit runs FIRST") that a
    // handler-only assertion can't distinguish from "authz ran and also
    // happened to deny."
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

describe("householdId is guarded from the schema, like clientId", () => {
  it("runs the household check and passes the parsed id", async () => {
    assertHouseholdReadable.mockResolvedValue(undefined);
    const tool = defineTool({
      name: "t_household",
      title: "t",
      description: "d",
      inputSchema: z.object({ householdId: z.string() }),
      handler: async () => ({ ok: true }),
    });
    await tool.run({ householdId: "hh1" }, principal);
    expect(assertHouseholdReadable).toHaveBeenCalledWith(principal, "hh1");
  });

  it("refuses when the schema declares householdId but the value is not a string", async () => {
    const tool = defineTool({
      name: "t_optional_household",
      title: "t",
      description: "d",
      // `.optional()` is the fail-open trap: duck-typing the value would skip
      // the check entirely and run the handler unauthorized.
      inputSchema: z.object({ householdId: z.string().optional() }),
      handler: async () => ({ ok: true }),
    });
    await expect(tool.run({}, principal)).rejects.toThrow(CLIENT_UNREADABLE_MESSAGE);
    expect(assertHouseholdReadable).not.toHaveBeenCalled();
  });

  it("never calls the household check for a tool that declares no householdId", async () => {
    const tool = defineTool({
      name: "t_bookwide",
      title: "t",
      description: "d",
      inputSchema: z.object({ query: z.string() }),
      handler: async () => ({ ok: true }),
    });
    await tool.run({ query: "x" }, principal);
    expect(assertHouseholdReadable).not.toHaveBeenCalled();
  });
});
