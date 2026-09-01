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

const claimPortalBindingMock = vi.fn();
vi.mock("@/lib/portal/claim-portal-binding", () => ({
  claimPortalBinding: (...a: unknown[]) => claimPortalBindingMock(...a),
}));

import "../proxy";

function makeReq(
  pathname: string,
  method = "GET",
  headers?: Record<string, string>,
) {
  const url = new URL(`https://app.foundryplanning.com${pathname}`);
  const req = new Request(url, { method, headers });
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
  claimPortalBindingMock.mockReset();
  claimPortalBindingMock.mockResolvedValue(null);
  delete process.env.BILLING_ENFORCEMENT_MODE;
});

/** Pathname of a redirect response, so assertions can be exact rather than
 *  substring — `/portal/organizer` is a prefix of `/portal/organizer/accounts`,
 *  and `toContain` could not tell the legacy shims from the real landings. */
function redirectPath(res: Response): string {
  return new URL(res.headers.get("location") ?? "", "https://x.invalid").pathname;
}

describe("proxy portal branching", () => {
  // Exact, not `toContain`: the point of this assertion is that the catch-all
  // lands on the Organizer itself and NOT on the retired /portal/profile shim,
  // which under the portal's streaming boundary costs a second full page load.
  it("redirects bound portal user from /clients to /portal/organizer", async () => {
    getPortalClientIdMock.mockResolvedValue("client-1");
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/clients"),
    );
    expect(res.status).toBe(307);
    expect(redirectPath(res)).toBe("/portal/organizer");
  });

  it("lets bound portal user reach /portal/*", async () => {
    getPortalClientIdMock.mockResolvedValue("client-1");
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/organizer"),
    );
    expect(res.status).not.toBe(307);
  });

  it("lets bound portal user reach a nested Organizer tab", async () => {
    getPortalClientIdMock.mockResolvedValue("client-1");
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/organizer/accounts"),
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
      makeReq("/portal/organizer"),
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

  it("lets advisor act-as-client API calls through when x-portal-as-client header is present", async () => {
    const res = await captured.handler!(
      authWith("u1", "org_advisor") as never,
      makeReq("/api/portal/plaid/link-token", "POST", {
        "x-portal-as-client": "client-1",
      }),
    );
    // Passes through to the route handler (which authorizes via
    // resolvePortalClient → requireClientEditAccess); NOT 307'd to /clients.
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location") ?? "").not.toContain("/clients");
  });

  it("still redirects advisor /api/portal/* calls that lack the act-as header", async () => {
    const res = await captured.handler!(
      authWith("u1", "org_advisor") as never,
      makeReq("/api/portal/plaid/link-token", "POST"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/clients");
  });

  it("self-heals an org-less user with a pending claim and sends them to /portal/organizer", async () => {
    getPortalClientIdMock.mockResolvedValue(null);
    claimPortalBindingMock.mockResolvedValue("client-2");
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/clients"),
    );
    expect(res.status).toBe(307);
    expect(redirectPath(res)).toBe("/portal/organizer");
  });

  it("redirects to /select-organization when there is no binding and no claim", async () => {
    getPortalClientIdMock.mockResolvedValue(null);
    claimPortalBindingMock.mockResolvedValue(null);
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/clients"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/select-organization");
  });

  it("lets an org-less self-serve buyer reach /welcome instead of bouncing to /select-organization", async () => {
    // /welcome is where a self-serve buyer names their firm before paying — they
    // are org-less there by design. If it ever drops out of isOrgPickerRoute,
    // this branch bounces every such buyer to /select-organization and the
    // whole profile-first funnel dies silently, with no test catching it.
    getPortalClientIdMock.mockResolvedValue(null);
    claimPortalBindingMock.mockResolvedValue(null);
    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/welcome"),
    );
    expect(res.status).not.toBe(307);
  });
});

describe("proxy soft-route: intake redirect", () => {
  it("redirects bound portal client with pending intake from /portal/organizer to /portal/intake", async () => {
    getPortalClientIdMock.mockResolvedValue("client-intake-1");
    hasUnsubmittedPrefilledFormMock.mockResolvedValue(true);

    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/organizer"),
    );
    expect(res.status).toBe(307); // temporary, method-preserving — not 308
    expect(res.headers.get("location")).toContain("/portal/intake");
  });

  it("does NOT redirect when client has no pending intake (hasUnsubmittedPrefilledForm=false)", async () => {
    getPortalClientIdMock.mockResolvedValue("client-intake-1");
    hasUnsubmittedPrefilledFormMock.mockResolvedValue(false);

    const res = await captured.handler!(
      authWith("u1", null) as never,
      makeReq("/portal/organizer"),
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
