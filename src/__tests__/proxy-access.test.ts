import { describe, it, expect, vi, beforeEach } from "vitest";

type HandlerFn = (
  auth: () => Promise<{ userId: string | null; orgId: string | null; sessionClaims: unknown }>,
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

const recordAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

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

function authWith(meta: Record<string, unknown>) {
  return async () => ({
    userId: "user_1",
    orgId: "org_1",
    sessionClaims: { org_public_metadata: meta },
    protect: vi.fn(),
  });
}

beforeEach(() => {
  recordAudit.mockClear();
  delete process.env.BILLING_ENFORCEMENT_MODE;
});

describe("proxy access enforcement", () => {
  it("LOG mode: audits a would-be denial but does NOT block a mutating API call", async () => {
    process.env.BILLING_ENFORCEMENT_MODE = "log";
    // canceled_grace → block_mutation (recently archived; within 30-day window)
    const recentArchivedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const res = await captured.handler!(
      authWith({ subscription_status: "canceled", archived_at: recentArchivedAt }) as never,
      makeReq("/api/clients/abc/accounts", "POST"),
    );
    // passthrough: not a 403
    expect(res.status).not.toBe(403);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.access_denied",
        firmId: "org_1",
        metadata: expect.objectContaining({
          decision: "block_mutation",
          mode: "log",
          method: "POST",
          path: "/api/clients/abc/accounts",
        }),
      }),
    );
  });

  it("ENFORCE mode: 403 JSON on a blocked mutating API call", async () => {
    process.env.BILLING_ENFORCEMENT_MODE = "enforce";
    const res = await captured.handler!(
      authWith({ subscription_status: "unpaid" }) as never,
      makeReq("/api/clients/abc/accounts", "POST"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "subscription_inactive" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "billing.access_denied",
        metadata: expect.objectContaining({ decision: "lock_out", mode: "enforce" }),
      }),
    );
  });

  it("ENFORCE mode: page request redirects to /settings/billing on lock_out", async () => {
    process.env.BILLING_ENFORCEMENT_MODE = "enforce";
    const res = await captured.handler!(
      authWith({ subscription_status: "unpaid" }) as never,
      makeReq("/clients/abc", "GET"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/settings/billing");
  });

  it("does NOT enforce against the billing settings page (avoids redirect loop)", async () => {
    process.env.BILLING_ENFORCEMENT_MODE = "enforce";
    const res = await captured.handler!(
      authWith({ subscription_status: "unpaid" }) as never,
      makeReq("/settings/billing", "GET"),
    );
    expect(res.status).not.toBe(307);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("LOG mode: STILL hard-blocks a missing-metadata page request (broken account)", async () => {
    process.env.BILLING_ENFORCEMENT_MODE = "log";
    const res = await captured.handler!(
      authWith({}) as never, // empty org metadata → missing
      makeReq("/clients/abc", "GET"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/settings/billing");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ decision: "lock_out", status: "missing" }),
      }),
    );
  });

  it("LOG mode: STILL 403s a missing-metadata mutating API call", async () => {
    process.env.BILLING_ENFORCEMENT_MODE = "log";
    const res = await captured.handler!(
      authWith({}) as never,
      makeReq("/api/clients/abc/accounts", "POST"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "subscription_inactive" });
  });

  it("allows an active firm through with no audit", async () => {
    process.env.BILLING_ENFORCEMENT_MODE = "enforce";
    const res = await captured.handler!(
      authWith({ subscription_status: "active" }) as never,
      makeReq("/api/clients/abc/accounts", "POST"),
    );
    expect(res.status).not.toBe(403);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
