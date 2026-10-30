import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireOrgAdminOrOwner: vi.fn(),
  requireActiveSubscription: vi.fn(),
  checkIntegrationOauthLimit: vi.fn(),
  createWorkspaceOauthState: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
// The real ForbiddenError/authErrorResponse, so a refused gate is the 403 every route gets.
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireOrgAdminOrOwner: mocks.requireOrgAdminOrOwner,
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkIntegrationOauthLimit: mocks.checkIntegrationOauthLimit,
}));
vi.mock("@/lib/workspace/oauth-states", () => ({
  createWorkspaceOauthState: mocks.createWorkspaceOauthState,
}));

import { POST } from "./route";

const TEN_MINUTES = 10 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 3600 * 1000;

function post(body: unknown): Request {
  return new Request("https://app.test/api/workspace/microsoft/admin-consent/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  vi.stubEnv("MICROSOFT_CLIENT_ID", "client-123");
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret-xyz");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1", orgRole: "org:admin" });
  mocks.requireOrgAdminOrOwner.mockResolvedValue(undefined);
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.checkIntegrationOauthLimit.mockResolvedValue({ allowed: true, remaining: 4, reset: 0 });
  mocks.createWorkspaceOauthState.mockResolvedValue("state-abc");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/workspace/microsoft/admin-consent/start", () => {
  it("is 404 when Workspace is off, before any gate or write", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    const res = await POST(post({ mode: "redirect" }));
    expect(res.status).toBe(404);
    expect(mocks.requireOrgAdminOrOwner).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("refuses a non-admin with 403 and mints no state", async () => {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(new ForbiddenError("Organization admin role required"));
    const res = await POST(post({ mode: "redirect" }));
    expect(res.status).toBe(403);
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("refuses an ops 'sign in as' session with 403, even as an admin, before the rate limit or any state", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1", orgRole: "org:admin", actor: { sub: "user_ops" } });
    const res = await POST(post({ mode: "link" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.checkIntegrationOauthLimit).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("refuses a lapsed firm with 403, after the admin check, and mints no state", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await POST(post({ mode: "redirect" }));
    expect(res.status).toBe(403);
    expect(mocks.requireOrgAdminOrOwner).toHaveBeenCalled();
    expect(mocks.checkIntegrationOauthLimit).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("mode link: a 7-day admin_consent state, and the Microsoft admin-consent URL", async () => {
    const res = await POST(post({ mode: "link" }));
    expect(res.status).toBe(200);
    expect(mocks.createWorkspaceOauthState).toHaveBeenCalledWith({
      firmId: "org_1",
      provider: "microsoft",
      kind: "admin_consent",
      userId: "user_admin",
      codeVerifier: null,
      ttlMs: SEVEN_DAYS,
    });
    const { url } = (await res.json()) as { url: string };
    expect(url.startsWith("https://login.microsoftonline.com/organizations/v2.0/adminconsent")).toBe(true);
    expect(new URL(url).searchParams.get("state")).toBe("state-abc");
  });

  it("mode redirect: a 10-minute state", async () => {
    const res = await POST(post({ mode: "redirect" }));
    expect(res.status).toBe(200);
    expect(mocks.createWorkspaceOauthState).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "admin_consent", ttlMs: TEN_MINUTES }),
    );
  });

  it("rate-limits per firm and mints no state when limited", async () => {
    mocks.checkIntegrationOauthLimit.mockResolvedValue({ allowed: false, reason: "exceeded", reset: Date.now() + 30_000 });
    const res = await POST(post({ mode: "redirect" }));
    expect(mocks.checkIntegrationOauthLimit).toHaveBeenCalledWith("ms_consent:org_1");
    expect(res.status).toBe(429);
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing mode", {}],
    ["an unknown mode", { mode: "popup" }],
    ["malformed JSON", "{not json"],
  ])("400s on %s, with no state", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("missing Microsoft app env is a generic 500 that logs no detail and mints no state", async () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ mode: "redirect" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("MICROSOFT_CLIENT_ID");
  });
});
