import { inspect } from "node:util";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  consumeWorkspaceOauthState: vi.fn(),
  exchangeCode: vi.fn(),
  revokeToken: vi.fn(),
  upsertUserConnection: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/oauth-states", () => ({
  consumeWorkspaceOauthState: mocks.consumeWorkspaceOauthState,
}));
vi.mock("@/lib/workspace/connections", () => ({ upsertUserConnection: mocks.upsertUserConnection }));
// The real readIdTokenClaims, hasRequiredScopes and GoogleAuthError: only the network calls are faked.
vi.mock("@/lib/workspace/google/oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace/google/oauth")>()),
  exchangeCode: mocks.exchangeCode,
  revokeToken: mocks.revokeToken,
}));

import { GET } from "./route";
import { GoogleAuthError } from "@/lib/workspace/google/oauth";

const CLIENT_ID = "google-client.apps.googleusercontent.com";
const SUB = "104729384756102938475";
const EMAIL = "dan@gmail.com";
const CODE = "4/0AeanS0b-auth-code";
const STATE = "state-abc";
const VERIFIER = "verifier-xyz";
const CALENDAR = "https://www.googleapis.com/auth/calendar.events";
const TASKS = "https://www.googleapis.com/auth/tasks";

function idToken(claims: Record<string, string>): string {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
}

const GMAIL_CLAIMS = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: SUB, email: EMAIL };
const ID_TOKEN = idToken(GMAIL_CLAIMS);
const TOKENS = {
  accessToken: "ya29.access-token",
  refreshToken: "1//refresh-token",
  expiresInSec: 3599,
  scope: `openid ${CALENDAR} ${TASKS} https://www.googleapis.com/auth/userinfo.email`,
  idToken: ID_TOKEN,
};

const userConnectState = {
  firmId: "org_1",
  provider: "google",
  kind: "user_connect",
  userId: "user_ada",
  codeVerifier: VERIFIER,
};

function callback(params: Record<string, string>): Request {
  const url = new URL("https://app.test/api/workspace/google/callback");
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
  return (["error", "warn", "log", "info", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
}

const SECRETS = [CODE, STATE, VERIFIER, TOKENS.accessToken, TOKENS.refreshToken, ID_TOKEN, EMAIL, SUB];

const signedIn = { code: CODE, state: STATE };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.test");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1" });
  mocks.consumeWorkspaceOauthState.mockResolvedValue(userConnectState);
  mocks.exchangeCode.mockResolvedValue(TOKENS);
  mocks.revokeToken.mockResolvedValue(undefined);
  mocks.upsertUserConnection.mockResolvedValue({ ok: true, id: "conn_1" });
  mocks.recordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/workspace/google/callback", () => {
  it("is 404 when Workspace is off, and never consumes the state", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(404);
    expect(mocks.consumeWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("is 404 while Google isn't configured, and never consumes the state", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(404);
    expect(mocks.consumeWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("a Gmail sign-in: keyed on the id_token's sub with no hosted domain, audited, → connected=google", async () => {
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?connected=google");

    expect(mocks.consumeWorkspaceOauthState).toHaveBeenCalledWith(STATE);
    expect(mocks.exchangeCode).toHaveBeenCalledWith({ code: CODE, codeVerifier: VERIFIER });
    expect(mocks.upsertUserConnection).toHaveBeenCalledWith({
      firmId: "org_1",
      userId: "user_ada",
      provider: "google",
      tenantId: "",
      externalUserId: SUB,
      externalEmail: EMAIL,
      tokens: TOKENS,
    });
    expect(mocks.revokeToken).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.connect",
        resourceType: "workspace_connection",
        resourceId: "conn_1",
        firmId: "org_1",
        actorId: "user_ada",
        metadata: { provider: "google", connectionId: "conn_1" },
      }),
    );
  });

  it("a Google Workspace sign-in stores its hosted domain where Microsoft's tenant goes", async () => {
    mocks.exchangeCode.mockResolvedValue({
      ...TOKENS,
      idToken: idToken({ ...GMAIL_CLAIMS, email: "dan@firm.example", hd: "firm.example" }),
    });
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?connected=google");
    expect(mocks.upsertUserConnection).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "firm.example", externalUserId: SUB, externalEmail: "dan@firm.example" }),
    );
  });

  it("reconnecting an address already connected (the store returns the same row) → connected=google", async () => {
    mocks.upsertUserConnection.mockResolvedValue({ ok: true, id: "conn_existing" });
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?connected=google");
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: "conn_existing", metadata: { provider: "google", connectionId: "conn_existing" } }),
    );
  });

  it.each([
    ["tasks", `openid ${CALENDAR}`],
    ["calendar.events", `openid ${TASKS}`],
    ["tasks (only tasks.readonly granted)", `openid ${CALENDAR} ${TASKS}.readonly`],
  ])("a consent with %s unticked → missing_permissions, the grant revoked, nothing stored", async (_label, scope) => {
    mocks.exchangeCode.mockResolvedValue({ ...TOKENS, scope });
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=missing_permissions");
    expect(mocks.revokeToken).toHaveBeenCalledTimes(1);
    expect(mocks.revokeToken).toHaveBeenCalledWith(TOKENS.refreshToken);
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["account_in_use", "/workspace?error=account_in_use&provider=google"],
    ["too_many_accounts", "/workspace?error=too_many_accounts&provider=google"],
  ])("the store refuses with %s → that code and the provider, no audit", async (reason, expected) => {
    mocks.upsertUserConnection.mockResolvedValue({ ok: false, reason });
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe(expected);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    // Revoking would withdraw the Google grant behind the connection that already holds this address.
    expect(mocks.revokeToken).not.toHaveBeenCalled();
  });

  it.each([
    ["admin_policy_enforced (the Workspace admin blocks Foundry)", "admin_policy_enforced", "google_blocked"],
    ["access_denied (the advisor cancelled)", "access_denied", "connect_declined"],
    ["any other error", "invalid_scope", "connect_failed"],
  ])("Google answers %s → its banner code, no exchange", async (_label, error, code) => {
    const spies = spyOnConsole();
    const res = await GET(callback({ error, error_description: "detail-not-for-logs", state: STATE }));
    expect(res.status).toBe(307);
    expect(target(res)).toBe(`/workspace?error=${code}`);
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    // The state is still burnt.
    expect(mocks.consumeWorkspaceOauthState).toHaveBeenCalledWith(STATE);
    expect(everythingLogged(spies)).not.toContain("detail-not-for-logs");
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
    ["a Microsoft sign-in state", { ...userConnectState, provider: "microsoft" }],
    ["an admin-consent state", { ...userConnectState, kind: "admin_consent", codeVerifier: null }],
    ["a user_connect state with no verifier", { ...userConnectState, codeVerifier: null }],
  ])("%s state → connect_failed, no exchange", async (_label, state) => {
    mocks.consumeWorkspaceOauthState.mockResolvedValue(state);
    const res = await GET(callback(signedIn));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
  });

  it("an id_token minted for another client → connect_failed, nothing stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.exchangeCode.mockResolvedValue({ ...TOKENS, idToken: idToken({ ...GMAIL_CLAIMS, aud: "someone-else" }) });
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();
  });

  it("no secrets in logs: a failed exchange → connect_failed, logging only the Google code", async () => {
    const spies = spyOnConsole();
    mocks.exchangeCode.mockRejectedValue(new GoogleAuthError("missing_id_token"));
    const res = await GET(callback(signedIn));
    expect(target(res)).toBe("/workspace?error=connect_failed");
    expect(mocks.upsertUserConnection).not.toHaveBeenCalled();

    const logged = everythingLogged(spies);
    expect(logged).toContain("missing_id_token");
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });

  it("an unexpected store failure → connect_failed, logging only the error's class (never its message)", async () => {
    const spies = spyOnConsole();
    // A DB error's message carries the query params: tokens, email, sub.
    mocks.upsertUserConnection.mockRejectedValue(
      new TypeError(`insert failed: params ${TOKENS.accessToken}, ${TOKENS.refreshToken}, ${EMAIL}, ${SUB}`),
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
