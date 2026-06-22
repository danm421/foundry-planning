import { describe, it, expect, vi, beforeEach } from "vitest";

type HandlerFn = (
  auth: () => Promise<{ userId: string | null; orgId: string | null; orgRole: string | undefined; sessionClaims: unknown }>,
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
  createRouteMatcher: (patterns: string[]) => {
    return (req: { nextUrl: URL }) => {
      const path = req.nextUrl.pathname;
      return patterns.some((p) => {
        const base = p.replace(/\(\.\*\)$/, "").replace(/\/\(\.\*\)$/, "/");
        return path === base || (base.length > 1 && path.startsWith(base));
      });
    };
  },
}));

const recordAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

// Make billing/ops inert so portal branching is the only thing under test.
vi.mock("@/lib/billing/access-policy", () => ({
  decideAccess: () => "allow",
}));
vi.mock("@/lib/operations-route-guard", () => ({
  operationsBlocked: () => false,
}));

const getPortalClientIdMock = vi.fn();
vi.mock("@/lib/portal/get-portal-client", () => ({
  getPortalClientId: (...a: unknown[]) => getPortalClientIdMock(...a),
}));

const hasUnsubmittedPrefilledFormMock = vi.fn();
vi.mock("@/lib/intake/queries", () => ({
  hasUnsubmittedPrefilledForm: (...a: unknown[]) =>
    hasUnsubmittedPrefilledFormMock(...a),
}));

import "../proxy";

function makeReq(pathname: string, method = "GET") {
  const url = new URL(`https://app.foundryplanning.com${pathname}`);
  const req = new Request(url, { method });
  return Object.defineProperty(req, "nextUrl", {
    value: url,
    writable: true,
    configurable: true,
  }) as Request & { nextUrl: URL };
}

function authWith(userId: string | null, orgId: string | null) {
  return async () => ({
    userId,
    orgId,
    orgRole: undefined as string | undefined,
    sessionClaims: { org_public_metadata: { subscription_status: "active" } },
    protect: vi.fn(),
  });
}

beforeEach(() => {
  recordAudit.mockClear();
  getPortalClientIdMock.mockReset();
  hasUnsubmittedPrefilledFormMock.mockReset();
  hasUnsubmittedPrefilledFormMock.mockResolvedValue(false); // default: no pending form
  delete process.env.BILLING_ENFORCEMENT_MODE;
});

describe("proxy portal branching", () => {
  it("redirects bound portal user from /clients to /portal/profile", async () => {
    getPortalClientIdMock.mockResolvedValue("client-1");
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/clients"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/portal/profile");
  });

  it("lets bound portal user reach /portal/*", async () => {
    getPortalClientIdMock.mockResolvedValue("client-1");
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/profile"),
    );
    expect(res.status).not.toBe(307);
  });

  it("redirects unbound signed-in user to /select-organization", async () => {
    getPortalClientIdMock.mockResolvedValue(null);
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/clients"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/select-organization");
  });

  it("redirects advisor away from /portal/* to /clients", async () => {
    const res = await captured.handler!(
      authWith("u1", "org_advisor") as never,
      makeReq("/portal/profile"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/clients");
  });

  it("lets advisor reach /clients without redirect", async () => {
    const res = await captured.handler!(
      authWith("u1", "org_advisor") as never,
      makeReq("/clients"),
    );
    expect(res.status).not.toBe(307);
  });
});

describe("proxy soft-route: intake redirect", () => {
  it("redirects bound portal client with pending intake from /portal/profile to /portal/intake", async () => {
    getPortalClientIdMock.mockResolvedValue("client-intake-1");
    hasUnsubmittedPrefilledFormMock.mockResolvedValue(true);

    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/profile"),
    );
    expect(res.status).toBeGreaterThanOrEqual(307);
    expect(res.status).toBeLessThanOrEqual(308);
    expect(res.headers.get("location")).toContain("/portal/intake");
  });

  it("does NOT redirect when client has no pending intake (hasUnsubmittedPrefilledForm=false)", async () => {
    getPortalClientIdMock.mockResolvedValue("client-intake-1");
    hasUnsubmittedPrefilledFormMock.mockResolvedValue(false);

    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/profile"),
    );
    // Should pass through, not redirect to /portal/intake
    expect(res.headers.get("location") ?? "").not.toContain("/portal/intake");
  });

  it("does NOT redirect when client is already on /portal/intake (no redirect loop)", async () => {
    getPortalClientIdMock.mockResolvedValue("client-intake-1");
    hasUnsubmittedPrefilledFormMock.mockResolvedValue(true);

    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/intake"),
    );
    // Should pass through (isPortalRoute), not loop back to /portal/intake
    expect(res.headers.get("location") ?? "").not.toContain("/portal/intake");
  });
});
