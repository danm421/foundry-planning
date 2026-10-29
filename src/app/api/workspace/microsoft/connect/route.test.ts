import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkIntegrationOauthLimit: vi.fn(),
  createWorkspaceOauthState: vi.fn(),
  getFirmApproval: vi.fn(),
  hasMemberAccess: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkIntegrationOauthLimit: mocks.checkIntegrationOauthLimit,
}));
vi.mock("@/lib/workspace/oauth-states", () => ({
  createWorkspaceOauthState: mocks.createWorkspaceOauthState,
}));
vi.mock("@/lib/workspace/approvals", () => ({ getFirmApproval: mocks.getFirmApproval }));
vi.mock("@/lib/workspace/access", () => ({ hasMemberAccess: mocks.hasMemberAccess }));

import { GET } from "./route";

const TENANT = "8f2c6b1e-3d4a-4f5b-9c7d-0e1f2a3b4c5d";
const TEN_MINUTES = 10 * 60 * 1000;

function connect(): Request {
  return new Request("https://app.test/api/workspace/microsoft/connect");
}

/** Path + query of a same-site redirect, so assertions don't depend on the host. */
function target(res: Response): string {
  const location = res.headers.get("location");
  if (!location) throw new Error(`no redirect (status ${res.status})`);
  const url = new URL(location);
  return url.pathname + url.search;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  vi.stubEnv("MICROSOFT_CLIENT_ID", "client-123");
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "secret-xyz");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.getFirmApproval.mockResolvedValue({ tenantId: TENANT, approvedScopes: "", approvedAt: new Date() });
  mocks.hasMemberAccess.mockResolvedValue(true);
  mocks.checkIntegrationOauthLimit.mockResolvedValue({ allowed: true, remaining: 4, reset: 0 });
  mocks.createWorkspaceOauthState.mockResolvedValue("state-abc");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/workspace/microsoft/connect", () => {
  it("is 404 when Workspace is off, before any read or write", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    const res = await GET(connect());
    expect(res.status).toBe(404);
    expect(mocks.getFirmApproval).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("refuses a request with no session (401) and mints no state", async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null });
    const res = await GET(connect());
    expect(res.status).toBe(401);
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("firm hasn't approved Microsoft 365 → /workspace?error=firm_not_approved, no state", async () => {
    mocks.getFirmApproval.mockResolvedValue(null);
    const res = await GET(connect());
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=firm_not_approved");
    expect(mocks.getFirmApproval).toHaveBeenCalledWith("org_1", "microsoft");
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("the advisor's switch is off → /workspace?error=member_off, no state", async () => {
    mocks.hasMemberAccess.mockResolvedValue(false);
    const res = await GET(connect());
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=member_off");
    expect(mocks.hasMemberAccess).toHaveBeenCalledWith("org_1", "user_ada", "microsoft");
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("switched on: a 10-minute user_connect state with the PKCE verifier, then Microsoft's sign-in on the firm's tenant", async () => {
    const res = await GET(connect());
    expect(res.status).toBe(307);

    expect(mocks.createWorkspaceOauthState).toHaveBeenCalledTimes(1);
    const stateInput = mocks.createWorkspaceOauthState.mock.calls[0][0];
    expect(stateInput).toEqual({
      firmId: "org_1",
      provider: "microsoft",
      kind: "user_connect",
      userId: "user_ada",
      codeVerifier: expect.any(String),
      ttlMs: TEN_MINUTES,
    });
    expect(stateInput.codeVerifier.length).toBeGreaterThanOrEqual(43);

    const url = new URL(res.headers.get("location")!);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe(`/${TENANT}/oauth2/v2.0/authorize`);
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/workspace/microsoft/callback");
    // The challenge Microsoft sees is the S256 of the verifier the state keeps.
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(stateInput.codeVerifier).digest("base64url"),
    );
  });

  // (M3) A browser follows the Connect link here: failures land back on
  // Workspace's "Couldn't connect" banner, never raw JSON in the tab.
  it("rate-limits per advisor: back to Workspace's banner, no state", async () => {
    mocks.checkIntegrationOauthLimit.mockResolvedValue({ allowed: false, reason: "exceeded", reset: Date.now() + 30_000 });
    const res = await GET(connect());
    expect(mocks.checkIntegrationOauthLimit).toHaveBeenCalledWith("ms_connect:user_ada");
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("missing Microsoft app env: back to Workspace's banner, logged without detail, no state", async () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(connect());
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("MICROSOFT_CLIENT_ID");
  });

  it("a database failure: back to Workspace's banner, logged by name only", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createWorkspaceOauthState.mockRejectedValue(new Error("Failed query: insert params: secret-verifier"));
    const res = await GET(connect());
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
  });
});
