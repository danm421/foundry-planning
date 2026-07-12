import { describe, it, expect, vi } from "vitest";

type HandlerFn = (
  auth: () => Promise<{
    userId: string | null;
    orgId: string | null;
    orgRole: string | undefined;
    sessionClaims: unknown;
  }>,
  request: Request & { nextUrl: URL },
) => Promise<Response> | Response;

// vi.hoisted runs before module evaluation, so this box is available when the
// vi.mock factory fires (even though vi.mock is hoisted before imports).
const captured = vi.hoisted(() => ({ handler: null as HandlerFn | null }));

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: HandlerFn) => {
    captured.handler = handler;
    return handler;
  },
  // createRouteMatcher returns a predicate; default to "not public / not org-picker".
  createRouteMatcher: (patterns: string[]) => {
    return (req: { nextUrl: URL }) => {
      const path = req.nextUrl.pathname;
      // Mark only the explicit public list members as public.
      return patterns.some((p) => {
        const base = p.replace(/\(\.\*\)$/, "").replace(/\/\(\.\*\)$/, "/");
        return path === base || (base.length > 1 && path.startsWith(base));
      });
    };
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/portal/claim-portal-binding", () => ({
  claimPortalBinding: vi.fn().mockResolvedValue(null),
}));

import "../proxy"; // evaluating the module captures the handler

function makeReq(pathname: string, method = "GET") {
  const url = new URL(`https://app.foundryplanning.com${pathname}`);
  const req = new Request(url, { method });
  // `url` is a read-only getter on Request; use defineProperty to attach
  // the Next.js-specific `nextUrl` without clobbering the native `url`.
  return Object.defineProperty(req, "nextUrl", {
    value: url,
    writable: true,
    configurable: true,
  }) as Request & { nextUrl: URL };
}

function unauthenticatedAuth() {
  return vi.fn(async () => ({
    userId: null,
    orgId: null,
    orgRole: undefined as string | undefined,
    sessionClaims: null,
    protect: vi.fn(),
  }));
}

// Guards Task 3 (AASA / universal links): clerkMiddleware's `config.matcher`
// is extension-based, and /.well-known/apple-app-site-association has NO
// extension (Apple requires that) — so the middleware DOES run on it. Before
// this fix, isPublicRoute didn't list the path, so an unauthenticated
// request (Apple's AASA crawler has no session cookie) fell through to
// `auth.protect()` and got 404'd/redirected before ever reaching the static
// file. iOS then refuses to trust the universal link. This test exercises
// the actual middleware handler (not just the static file on disk, which
// `src/app/__tests__/aasa.test.ts` already covers) to guard the gap.
describe("proxy public routes: .well-known", () => {
  it("treats /.well-known/apple-app-site-association as public — no auth() call, no redirect/403/404", async () => {
    const auth = unauthenticatedAuth();
    const res = await captured.handler!(
      auth as never,
      makeReq("/.well-known/apple-app-site-association"),
    );
    expect(auth).not.toHaveBeenCalled();
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("covers the /.well-known subtree generally (e.g. Android assetlinks.json)", async () => {
    const auth = unauthenticatedAuth();
    const res = await captured.handler!(
      auth as never,
      makeReq("/.well-known/assetlinks.json"),
    );
    expect(auth).not.toHaveBeenCalled();
    expect(res.status).not.toBe(307);
  });
});
