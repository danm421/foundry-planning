import { describe, it, expect, vi } from "vitest";
import type { NextFetchEvent, NextRequest } from "next/server";

/**
 * F6 (controller, measured over the wire against a real `next dev`): a Bearer
 * header shaped like a JWT (three dot-separated segments) whose segments
 * aren't valid base64url — e.g. `Bearer not.a.jwt` — makes Clerk's own
 * `authenticateRequest` throw a raw `SyntaxError` BEFORE `src/proxy.ts`'s own
 * callback (and its `isPublicRoute` exemption for `/api/mcp`) ever runs. This
 * file proves the fix at the layer it actually lives: the wrapper around
 * whatever `clerkMiddleware(...)` returns, NOT the callback passed into it
 * (every other `proxy-*.test.ts` in this directory mocks `clerkMiddleware` to
 * hand back the callback directly, which is exactly why none of them could
 * ever see this bug — the real crash happens INSIDE Clerk's own machinery,
 * upstream of that callback).
 *
 * `clerkMiddleware` here is mocked to return a function that either throws
 * the exact `SyntaxError` Clerk's real `decodeJwt` throws for this token
 * shape, or resolves normally — standing in for "Clerk's internal
 * authentication step," not for the app's own callback logic (which is
 * unreachable for this bug regardless of what it contains).
 */
const state = vi.hoisted(() => ({ throwAs: null as "syntax" | "other" | null }));

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: () => async () => {
    if (state.throwAs === "syntax") {
      // The exact shape @clerk/backend's decodeJwt throws for a 3-segment
      // Authorization bearer whose segments aren't valid base64url
      // (node_modules/@clerk/backend/dist/index.js:1259).
      throw new SyntaxError("Unexpected end of data");
    }
    if (state.throwAs === "other") {
      throw new Error("some unrelated failure inside Clerk's own request handling");
    }
    return new Response(null, { status: 200 });
  },
  createRouteMatcher: (patterns: string[]) => (req: { nextUrl: URL }) => {
    const path = req.nextUrl.pathname;
    return patterns.some((p) => {
      const base = p.replace(/\(\.\*\)$/, "");
      return path === base || path.startsWith(base);
    });
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/portal/claim-portal-binding", () => ({
  claimPortalBinding: vi.fn().mockResolvedValue(null),
}));

import proxy from "../proxy";

function makeReq(pathname: string, opts: { auth?: string } = {}): NextRequest {
  const url = new URL(`https://app.foundryplanning.com${pathname}`);
  const headers = new Headers();
  if (opts.auth) headers.set("authorization", opts.auth);
  const req = new Request(url, { headers });
  return Object.defineProperty(req, "nextUrl", {
    value: url,
    writable: true,
    configurable: true,
  }) as unknown as NextRequest;
}

describe("proxy: a malformed bearer token on /api/mcp (F6)", () => {
  it("turns Clerk's raw SyntaxError into a 401 with the RFC 9728 challenge, not a bare 500", async () => {
    state.throwAs = "syntax";
    // Non-null: proxy's inferred return type is Next's NextMiddlewareResult,
    // which permits `undefined` ("continue"), but every branch this test
    // exercises returns a real Response.
    const res = (await proxy(makeReq("/api/mcp", { auth: "Bearer not.a.jwt" }), {} as NextFetchEvent))!;
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/bearer/i);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata");
    // The challenge must point back at THIS request's own origin.
    expect(res.headers.get("www-authenticate")).toContain(
      "https://app.foundryplanning.com/.well-known/oauth-protected-resource",
    );
  });

  it("does NOT swallow the same crash on a non-MCP route — still throws, unhandled", async () => {
    state.throwAs = "syntax";
    await expect(
      proxy(makeReq("/clients", { auth: "Bearer not.a.jwt" }), {} as NextFetchEvent),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  // Guards the OTHER half of the same condition: only a SyntaxError is
  // reinterpreted as a bad-token challenge, even ON /api/mcp — an unrelated
  // crash inside Clerk's own request handling must not be misreported as an
  // auth failure.
  it("does NOT swallow an unrelated (non-SyntaxError) crash on /api/mcp — still throws, unhandled", async () => {
    state.throwAs = "other";
    await expect(proxy(makeReq("/api/mcp", { auth: "Bearer not.a.jwt" }), {} as NextFetchEvent)).rejects.toThrow(
      "some unrelated failure inside Clerk's own request handling",
    );
  });

  it("passes a real (non-throwing) request through untouched — control", async () => {
    state.throwAs = null;
    const res = (await proxy(makeReq("/api/mcp", { auth: "Bearer a.real.token" }), {} as NextFetchEvent))!;
    expect(res.status).toBe(200);
  });
});
