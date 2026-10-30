import { inspect } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  consumeWorkspaceOauthState: vi.fn(),
  getFirmApproval: vi.fn(),
  exchangeCode: vi.fn(),
  upsertUserConnection: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/oauth-states", () => ({
  consumeWorkspaceOauthState: mocks.consumeWorkspaceOauthState,
}));
// Phase 1 gated the callback on the firm's approval; it no longer does.
vi.mock("@/lib/workspace/approvals", () => ({ getFirmApproval: mocks.getFirmApproval }));
vi.mock("@/lib/workspace/connections", () => ({ upsertUserConnection: mocks.upsertUserConnection }));
// The real readIdTokenClaims and MicrosoftAuthError: only the network call is faked.
vi.mock("@/lib/workspace/microsoft/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/microsoft/oauth")>()),
  exchangeCode: mocks.exchangeCode,
}));

import { GET } from "./route";
import { MicrosoftAuthError } from "@/lib/workspace/microsoft/oauth";

const TENANT = "8f2c6b1e-3d4a-4f5b-9c7d-0e1f2a3b4c5d";
const OTHER_TENANT = "11111111-2222-4333-8444-555555555555";
const OID = "oid-5b1f9d2e";
const EMAIL = "ada@firm.example";
const CODE = "auth-code-0AQABAAIAAAD";
const STATE = "state-abc";
const VERIFIER = "verifier-xyz";

function idToken(claims: Record<string, string>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
}

const ID_TOKEN = idToken({ tid: TENANT, oid: OID, preferred_username: EMAIL });
const TOKENS = {
  accessToken: "access-token-eyJ0eXAi",
  refreshToken: "refresh-token-0.AXkA",
  expiresInSec: 3600,
  scope: "openid profile offline_access User.Read",
  idToken: ID_TOKEN,
};

const userConnectState = {
  firmId: "org_1",
  provider: "microsoft",
  kind: "user_connect",
  userId: "user_ada",
  codeVerifier: VERIFIER,
};

function callback(params: Record<string, string>): Request {
  const url = new URL("https://app.test/api/workspace/microsoft/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

/** Path + query of the redirect, so assertions don't depend on the host. */
function target(res: Response): string {
  const location = res.headers.get("location");
  if (!location) throw new Error(`no redirect (status ${res.status})`);
  const url = new URL(location);
  return url.pathname + url.search;
}

/** Every argument of every console call, Errors included (JSON.stringify drops an Error's message). */
function everythingLogged(spies: MockInstance[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls.flat())
    .map((arg) => inspect(arg, { depth: 10 }))
    .join("\n");
}

function spyOnConsole(): MockInstance[] {
  return (["error", "warn", "log", "info"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
}

const SECRETS = [CODE, STATE, VERIFIER, TOKENS.accessToken, TOKENS.refreshToken, ID_TOKEN, EMAIL, OID, TENANT];

const signedIn = { code: CODE, state: STATE };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1" });
  mocks.consumeWorkspaceOauthState.mockResolvedValue(userConnectState);
  mocks.getFirmApproval.mockResolvedValue(null);
  mocks.exchangeCode.mockResolvedValue(TOKENS);
  mocks.upsertUserConnection.mockResolvedValue({ ok: true, id: "conn_1" });
  mocks.recordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/workspace/microsoft/callback", () => {
  it("is 404 when Workspace is off, and never consumes the state", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(404);
    expect(mocks.consumeWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("happy path: exchanges at Microsoft, stores the id_token's tenant + oid + email, audits, → connected=microsoft", async () => {
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?connected=microsoft");

    expect(mocks.consumeWorkspaceOauthState).toHaveBeenCalledWith(STATE);
    expect(mocks.exchangeCode).toHaveBeenCalledWith({ code: CODE, codeVerifier: VERIFIER });
    // No firm approval is needed (the firm has none here).
    expect(mocks.getFirmApproval).not.toHaveBeenCalled();
    expect(mocks.upsertUserConnection).toHaveBeenCalledWith({
      firmId: "org_1",
      userId: "user_ada",
      provider: "microsoft",
      tenantId: TENANT,
      externalUserId: OID,
      externalEmail: EMAIL,
      tokens: TOKENS,
    });
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.connect",
        resourceId: "conn_1",
        firmId: "org_1",
        actorId: "user_ada",
        metadata: { provider: "microsoft", connectionId: "conn_1" },
      }),
    );
  });

  it("another organization's sign-in is stored with that tenant, lower-cased", async () => {
    mocks.exchangeCode.mockResolvedValue({
      ...TOKENS,
      idToken: idToken({ tid: OTHER_TENANT.toUpperCase(), oid: OID, preferred_username: EMAIL }),
    });
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?connected=microsoft");
    expect(mocks.upsertUserConnection).toHaveBeenCalledWith(expect.objectContaining({ tenantId: OTHER_TENANT }));
  });

  it.each([
    ["account_in_use", "/workspace?error=account_in_use&provider=microsoft"],
    ["too_many_accounts", "/workspace?error=too_many_accounts&provider=microsoft"],
  ])("the store refuses with %s → that code and the provider, no audit", async (reason, expected) => {
    mocks.upsertUserConnection.mockResolvedValue({ ok: false, reason });
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe(expected);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("an ops 'sign in as' session → impersonating, no exchange, nothing stored", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", actor: { sub: "user_ops" } });
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=impersonating");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["a different user in the same firm", { userId: "user_bob", orgId: "org_1" }],
    ["the same user id in another firm", { userId: "user_ada", orgId: "org_other" }],
    ["no session at all", { userId: null, orgId: null }],
  ])("403 for %s, with no exchange", async (_label, session) => {
    mocks.auth.mockResolvedValue(session);
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(403);
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the organization needs an admin (AADSTS65001)",
      { error: "access_denied", error_description: "AADSTS65001: The user or administrator has not consented" },
      "needs_admin_approval",
    ],
    [
      "an admin-only permission (AADSTS90094)",
      { error: "invalid_request", error_description: "AADSTS90094: The grant requires admin permission." },
      "needs_admin_approval",
    ],
    ["consent_required", { error: "consent_required" }, "needs_admin_approval"],
    [
      "the advisor cancelled (AADSTS65004)",
      { error: "access_denied", error_description: "AADSTS65004: User declined to consent" },
      "connect_declined",
    ],
    ["any other error", { error: "server_error", error_description: "AADSTS50000: oops" }, "connect_failed"],
  ])("Microsoft answers with %s → its banner code, no exchange, the description never logged", async (_label, params, code) => {
    const spies = spyOnConsole();
    const res = await GET(callback({ ...params, state: STATE }));
    expect(res.status).toBe(307);
    expect(target(res)).toBe(`/workspace?error=${code}`);
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    // The state is still burnt.
    expect(mocks.consumeWorkspaceOauthState).toHaveBeenCalledWith(STATE);
    expect(everythingLogged(spies)).not.toContain("AADSTS");
  });

  it("no code → connect_failed, no exchange", async () => {
    const res = await GET(callback({ state: STATE }));
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it("no state param → connect_failed, nothing consumed", async () => {
    const res = await GET(callback({ code: CODE }));
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.consumeWorkspaceOauthState).not.toHaveBeenCalled();
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown or expired", null],
    ["an admin-consent state", { ...userConnectState, kind: "admin_consent", codeVerifier: null }],
    ["a user_connect state with no verifier", { ...userConnectState, codeVerifier: null }],
    ["a Google sign-in state", { ...userConnectState, provider: "google" }],
  ])("%s state → connect_failed, no exchange", async (_label, state) => {
    mocks.consumeWorkspaceOauthState.mockResolvedValue(state);
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
  });

  it("a token response with no id_token → connect_failed, nothing stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.exchangeCode.mockResolvedValue({ ...TOKENS, idToken: null });
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
  });

  it("an id_token missing its oid → connect_failed, nothing stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.exchangeCode.mockResolvedValue({ ...TOKENS, idToken: idToken({ tid: TENANT, preferred_username: EMAIL }) });
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
  });

  it("no secrets in logs: an invalid_grant exchange → connect_failed, logging only the Microsoft code", async () => {
    const spies = spyOnConsole();
    mocks.exchangeCode.mockRejectedValue(new MicrosoftAuthError("invalid_grant", 400));
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();

    const logged = everythingLogged(spies);
    expect(logged).toContain("invalid_grant");
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });

  it("an unexpected store failure → connect_failed, logging only the error's class (never its message)", async () => {
    const spies = spyOnConsole();
    // A DB error's message carries the query params: tokens, email, oid.
    mocks.upsertUserConnection.mockRejectedValue(
      new TypeError(`insert failed: params ${TOKENS.accessToken}, ${TOKENS.refreshToken}, ${EMAIL}, ${OID}, ${TENANT}`),
    );
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.recordAudit).not.toHaveBeenCalled();

    const logged = everythingLogged(spies);
    expect(logged).toContain("TypeError");
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });
});
