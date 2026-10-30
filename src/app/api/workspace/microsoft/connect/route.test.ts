import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkIntegrationOauthLimit: vi.fn(),
  createWorkspaceOauthState: vi.fn(),
  getFirmApproval: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkIntegrationOauthLimit: mocks.checkIntegrationOauthLimit,
}));
vi.mock("@/lib/workspace/oauth-states", () => ({
  createWorkspaceOauthState: mocks.createWorkspaceOauthState,
}));
// Phase 1 gated connect on the firm's approval; it no longer does.
vi.mock("@/lib/workspace/approvals", () => ({ getFirmApproval: mocks.getFirmApproval }));

import { GET } from "./route";

const TEN_MINUTES = 10 * 60 * 1000;

function connect(query = ""): Request {
  return new Request(`https://app.test/api/workspace/microsoft/connect${query}`);
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
  mocks.getFirmApproval.mockResolvedValue(null);
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
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("refuses a request with no session (401) and mints no state", async () => {
    mocks.auth.mockResolvedValue({ userId: null, orgId: null });
    const res = await GET(connect());
    expect(res.status).toBe(401);
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("an ops 'sign in as' session → /workspace?error=impersonating, no rate-limit hit, no state", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", actor: { sub: "user_ops" } });
    const res = await GET(connect());
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=impersonating");
    expect(mocks.checkIntegrationOauthLimit).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("with no firm approval row it still redirects to Microsoft: no approval or member check", async () => {
    const res = await GET(connect());
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).origin).toBe("https://login.microsoftonline.com");
    expect(mocks.getFirmApproval).not.toHaveBeenCalled();
  });

  it("a 10-minute user_connect state with the PKCE verifier, then Microsoft's multi-organization sign-in", async () => {
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
    expect(url.pathname).toBe("/organizations/oauth2/v2.0/authorize");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/workspace/microsoft/callback");
    expect(url.searchParams.has("login_hint")).toBe(false);
    // The challenge Microsoft sees is the S256 of the verifier the state keeps.
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(stateInput.codeVerifier).digest("base64url"),
    );
  });

  it("a reconnect's ?hint=<email> goes to Microsoft as login_hint", async () => {
    const res = await GET(connect("?hint=ada%40firm.example"));
    expect(new URL(res.headers.get("location")!).searchParams.get("login_hint")).toBe("ada@firm.example");
  });

  it("a hint that isn't an email address is dropped", async () => {
    const res = await GET(connect("?hint=not-an-email"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).searchParams.has("login_hint")).toBe(false);
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
