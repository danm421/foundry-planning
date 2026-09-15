import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";

/**
 * F3 (Task 12 fix round 1, CRITICAL C2): the auth/wiring boundary at
 * route.ts:128-212 had ZERO test coverage — every case in route.test.ts
 * targets an exported PURE function (`audienceIsAcceptable`,
 * `toolFailureResult`, `recordDenial`, `verifyToken` in isolation), never
 * the mounted `GET`/`POST` (the real `authHandler` returned by
 * `withMcpAuth(handler, verifyToken, {...})`). Nine one-line mutations there
 * survived all 178 tests on this branch, including the exact wrong-SDK
 * shape (`ctx.http?.authInfo` vs `ctx.authInfo`) a previous implementer
 * nearly shipped and only `tsc` caught.
 *
 * This file drives the REAL exported `POST` (aliased `authHandler`) with
 * real HTTP `Request` objects carrying real JSON-RPC bodies, over:
 *  - the REAL, unmocked `resolveMcpPrincipal` — verified against a LOCAL
 *    JWKS built from a real RS256 keypair, exactly like principal.test.ts,
 *    so F1's and F2's gates (which live inside `resolveMcpPrincipal`) run
 *    for real and a deletion of either is reddened here, not simulated by a
 *    mock that already assumes the gate fired;
 *  - the REAL `ALL_MCP_TOOLS` registry (all 17 tools) for `tools/list`;
 *  - one REAL tool (`search_clients`) for `tools/call`, with only its own
 *    DB dependency (`@/lib/client-search`) mocked — proving the WIRING
 *    (auth → dispatch → tool.run → response), not re-testing that tool's
 *    business logic (already covered by discovery-tools.test.ts).
 *
 * Only Clerk's org-membership lookup and the JWKS *fetch* are doubled
 * (`@clerk/nextjs/server`, and `createRemoteJWKSet` inside `jose` — every
 * other jose export, including the real `jwtVerify`/`SignJWT`/`decodeJwt`,
 * runs unmocked via `importOriginal`).
 */
const h = vi.hoisted(() => ({
  jwks: null as null | ReturnType<typeof createLocalJWKSet>,
  getOrganizationMembershipList: vi.fn(),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => {
      if (!h.jwks) throw new Error("test key set not initialised");
      return h.jwks;
    },
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { getOrganizationMembershipList: h.getOrganizationMembershipList },
  }),
}));

// search_clients's one DB dependency. Its schema declares no `clientId`, so
// `defineTool`'s per-client check never runs for it — the simplest real
// tool for proving the wiring without also needing to mock authz.
const { searchClients } = vi.hoisted(() => ({ searchClients: vi.fn() }));
vi.mock("@/lib/client-search", () => ({ searchClients }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));

import { POST } from "../route";
import { ALL_MCP_TOOLS } from "@/domain/mcp/tools";

// Same dev-instance fixture principal.test.ts uses.
const PUBLISHABLE_KEY = "pk_test_YXNzdXJpbmctbW9ua2Zpc2gtOTQuY2xlcmsuYWNjb3VudHMuZGV2JA";
const ISSUER = "https://assuring-monkfish-94.clerk.accounts.dev";
const USER_ID = "user_3JL11RLiKzZBVP2jNXgW1GmM0el";
const ORG_ID = "org_3JL0ojAeQgaTUQXnzY0VsqC7COO";
const KID = "ins_3CNCTqYj2IJDyxXfnToclorCi7K";
const SCOPE = "profile email user:org:read offline_access";
const ORIGINAL_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

let clerkKeys: Awaited<ReturnType<typeof generateKeyPair>>;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = PUBLISHABLE_KEY;
  clerkKeys = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(clerkKeys.publicKey)), kid: KID, alg: "RS256" };
  h.jwks = createLocalJWKSet({ keys: [jwk] });
});

afterAll(() => {
  if (ORIGINAL_PUBLISHABLE_KEY === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = ORIGINAL_PUBLISHABLE_KEY;
});

async function mintToken(opts: { scope?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    client_id: "M9NpdFrml5CuYHwW",
    jti: "oat_72EKJWP5V50YKPWF",
    org_id: ORG_ID,
    scope: opts.scope ?? SCOPE,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "at+jwt" })
    .setSubject(USER_ID)
    .setIssuer(ISSUER)
    .setIssuedAt(now - 5)
    .setNotBefore(now - 5)
    .setExpirationTime(now + 3600)
    .sign(clerkKeys.privateKey);
}

function membership(role: string, publicMetadata: Record<string, unknown> = { is_founder: true }) {
  return { data: [{ role, organization: { id: ORG_ID, publicMetadata } }], totalCount: 1 };
}

function mcpRequest(body: unknown, opts: { auth?: string } = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Both media types are required by the SDK's own Accept-header check for
    // a POST containing a JSON-RPC request (WebStandardStreamableHTTPServerTransport.handlePostRequest) —
    // a real MCP client sends both.
    accept: "application/json, text/event-stream",
  };
  if (opts.auth) headers.authorization = opts.auth;
  return new Request("https://x.test/api/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

/**
 * The SDK answers a successful/erroring tool call over an SSE body (legacy
 * stateless mode never sets `enableJsonResponse`), but an auth-layer
 * rejection from `withMcpAuth` is a plain `Response.json(...)`. This reads
 * either shape. The SSE stream closes itself once this single request's
 * response has been written (`WebStandardStreamableHTTPServerTransport`'s
 * `send()` calls `stream.cleanup()` — which calls `streamController.close()`
 * — once every related request id has a response), so `res.text()`
 * resolves; it does not hang waiting for a long-lived connection.
 */
/** The narrow slice of a JSON-RPC 2.0 envelope this file's assertions read. */
type McpJsonRpcResponse = {
  result?: {
    tools?: Array<{ name: string }>;
    isError?: boolean;
    structuredContent?: unknown;
  };
  error?: { code: number; message: string };
};

async function readMcpResponse(
  res: Response,
): Promise<{ status: number; json: McpJsonRpcResponse | null }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { status: res.status, json: await res.json() };
  }
  const raw = await res.text();
  const dataLine = raw
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data:")))
    .filter((l): l is string => Boolean(l))
    .map((l) => l.slice("data:".length).trim())
    .filter((s) => s.length > 0)
    .pop();
  return { status: res.status, json: dataLine ? JSON.parse(dataLine) : null };
}

beforeEach(() => {
  h.getOrganizationMembershipList.mockReset();
  h.getOrganizationMembershipList.mockResolvedValue(membership("org:member"));
  searchClients.mockReset().mockResolvedValue([{ id: "c1", householdTitle: "Smith" }]);
});

describe("route.ts auth/wiring boundary, driven over the real authHandler (F3, Critical C2)", () => {
  it("an unauthenticated POST reaches no tool and gets a 401 with the connector's challenge", async () => {
    const res = await POST(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search_clients", arguments: { query: "smith" } },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/bearer/i);
    expect(searchClients).not.toHaveBeenCalled();
  });

  it("an authenticated tools/list returns every real registered tool, not an empty catalogue", async () => {
    const res = await POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { auth: `Bearer ${await mintToken()}` },
      ),
    );
    const { status, json } = await readMcpResponse(res);
    expect(status).toBe(200);
    const tools = json?.result?.tools;
    expect(tools).toBeDefined();
    expect(tools).toHaveLength(ALL_MCP_TOOLS.length);
    expect(tools?.map((t) => t.name).sort()).toEqual(ALL_MCP_TOOLS.map((t) => t.name).sort());
  });

  it("an authenticated tools/call reaches the real tool.run and returns its structuredContent", async () => {
    const res = await POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "search_clients", arguments: { query: "smith" } },
        },
        { auth: `Bearer ${await mintToken()}` },
      ),
    );
    const { status, json } = await readMcpResponse(res);
    expect(status).toBe(200);
    expect(searchClients).toHaveBeenCalledTimes(1);
    expect(json?.result?.isError).toBeFalsy();
    expect(json?.result?.structuredContent).toEqual({
      households: [{ id: "c1", householdTitle: "Smith" }],
    });
  });

  it("tools/call always passes the TOKEN's orgId to the tool, never a value the request supplies", async () => {
    const res = await POST(
      mcpRequest(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          // search_clients's schema declares only `query`; a real MCP
          // client cannot smuggle an org id through `arguments`, but a
          // firmId-from-args regression wouldn't care what the schema
          // declares — it would read the raw body before Zod strips it.
          params: { name: "search_clients", arguments: { query: "smith", firmId: "org_attacker" } },
        },
        { auth: `Bearer ${await mintToken()}` },
      ),
    );
    await readMcpResponse(res);
    expect(searchClients).toHaveBeenCalledWith(
      "smith",
      ORG_ID,
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  describe("F1 — a staff-role token reaches no tool (Rulings R82/R83)", () => {
    it("blocks org:operations end to end, through the real resolveMcpPrincipal", async () => {
      h.getOrganizationMembershipList.mockResolvedValue(membership("org:operations"));
      const res = await POST(
        mcpRequest(
          {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "search_clients", arguments: { query: "smith" } },
          },
          { auth: `Bearer ${await mintToken()}` },
        ),
      );
      expect(res.status).toBe(401);
      expect(searchClients).not.toHaveBeenCalled();
    });
  });

  describe("F2 — a locked-out firm's token reaches no tool (Rulings R84/R85)", () => {
    it("blocks a firm with no billing metadata end to end, through the real resolveMcpPrincipal", async () => {
      h.getOrganizationMembershipList.mockResolvedValue(membership("org:member", {}));
      const res = await POST(
        mcpRequest(
          {
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "search_clients", arguments: { query: "smith" } },
          },
          { auth: `Bearer ${await mintToken()}` },
        ),
      );
      expect(res.status).toBe(401);
      expect(searchClients).not.toHaveBeenCalled();
    });
  });

  describe("F5 — requiredScopes: [\"user:org:read\"] makes the org-scope guarantee explicit at the boundary", () => {
    it("refuses a token whose scopes lack user:org:read, with the same OAuth challenge shape (no tool reached)", async () => {
      const res = await POST(
        mcpRequest(
          { jsonrpc: "2.0", id: 6, method: "tools/list", params: {} },
          { auth: `Bearer ${await mintToken({ scope: "profile email offline_access" })}` },
        ),
      );
      expect(res.status).toBe(403);
      expect(res.headers.get("www-authenticate")).toMatch(/bearer/i);
      expect(res.headers.get("www-authenticate")).toContain("resource_metadata");
    });

    it("accepts a token carrying exactly user:org:read and nothing else", async () => {
      const res = await POST(
        mcpRequest(
          { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} },
          { auth: `Bearer ${await mintToken({ scope: "user:org:read" })}` },
        ),
      );
      const { status, json } = await readMcpResponse(res);
      expect(status).toBe(200);
      expect(json?.result?.tools).toHaveLength(ALL_MCP_TOOLS.length);
    });
  });
});
