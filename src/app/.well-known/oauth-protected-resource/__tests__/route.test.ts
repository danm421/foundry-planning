import { describe, it, expect, vi, beforeEach } from "vitest";

// D3 (Ruling R74): this route must advertise the SAME issuer
// `resolveMcpPrincipal` verifies tokens against — both read from
// `deriveIssuer()`, one derivation. Mock it directly so the test pins that
// call, rather than the publishable-key parsing `deriveIssuer` itself does
// (already covered where `principal.ts` is tested).
//
// F5 (Task 12 fix round 1): this route also now imports `MCP_RESOURCE_URL`
// from the same module instead of defining its own `RESOURCE` literal, so
// the mock must supply that too.
const { deriveIssuer, MCP_RESOURCE_URL } = vi.hoisted(() => ({
  deriveIssuer: vi.fn(),
  MCP_RESOURCE_URL: "https://app.foundryplanning.com/api/mcp",
}));
vi.mock("@/lib/mcp/principal", () => ({ deriveIssuer, MCP_RESOURCE_URL }));

import { GET, OPTIONS } from "../route";

beforeEach(() => {
  deriveIssuer.mockReset().mockReturnValue("https://assuring-monkfish-94.clerk.accounts.dev");
});

describe("GET /.well-known/oauth-protected-resource (D3)", () => {
  it("advertises deriveIssuer()'s own issuer as the authorization server, not a hardcoded prod fallback", async () => {
    const res = GET();
    const body = await res.json();
    expect(body.authorization_servers).toEqual(["https://assuring-monkfish-94.clerk.accounts.dev"]);
    expect(deriveIssuer).toHaveBeenCalledTimes(1);
  });

  it("advertises the MCP endpoint itself as the resource, not the bare origin", async () => {
    const res = GET();
    const body = await res.json();
    expect(body.resource).toMatch(/\/api\/mcp$/);
  });

  it("declares the scopes and bearer method the connector actually uses", async () => {
    const res = GET();
    const body = await res.json();
    expect(body.scopes_supported).toEqual(["profile", "email", "user:org:read"]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
  });

  it("F8 (minor m6): answers a clean, logged 500 instead of an uncaught throw when deriveIssuer() fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    deriveIssuer.mockImplementation(() => {
      throw new Error("this server is not configured for MCP access");
    });
    let res: Response;
    // Before F8 this call THROWS out of GET() entirely, rather than
    // returning a Response — expect.not.toThrow proves the uncaught-throw
    // mutation (removing the try/catch) would fail this assertion.
    expect(() => {
      res = GET();
    }).not.toThrow();
    const body = await res!.json();
    expect(res!.status).toBe(500);
    expect(body.error).toBeTruthy();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("OPTIONS /.well-known/oauth-protected-resource", () => {
  it("answers the CORS preflight with a 2xx and an Allow-Origin header", async () => {
    const res = await OPTIONS();
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });
});
