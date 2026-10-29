import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  consumeWorkspaceOauthState: vi.fn(),
  upsertFirmApproval: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/oauth-states", () => ({
  consumeWorkspaceOauthState: mocks.consumeWorkspaceOauthState,
}));
vi.mock("@/lib/workspace/approvals", () => ({ upsertFirmApproval: mocks.upsertFirmApproval }));

import { GET } from "./route";
import { MICROSOFT_SCOPES } from "@/lib/workspace/microsoft/config";

const TENANT = "8f2c6b1e-3d4a-4f5b-9c7d-0e1f2a3b4c5d";

const adminConsentState = {
  firmId: "org_1",
  provider: "microsoft",
  kind: "admin_consent",
  userId: "user_admin",
  codeVerifier: null,
};

function callback(params: Record<string, string>): Request {
  const url = new URL("https://app.test/api/workspace/microsoft/admin-consent/callback");
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

const approvedParams = { tenant: TENANT, state: "state-abc", admin_consent: "True" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: null, orgId: null });
  mocks.consumeWorkspaceOauthState.mockResolvedValue(adminConsentState);
  mocks.upsertFirmApproval.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/workspace/microsoft/admin-consent/callback", () => {
  it("is 404 when Workspace is off, and never consumes the state", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    const res = await GET(callback(approvedParams));
    expect(res.status).toBe(404);
    expect(mocks.consumeWorkspaceOauthState).not.toHaveBeenCalled();
  });

  it("approval with a session in the same firm: saves the tenant, audits, returns to settings", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1" });
    const res = await GET(callback(approvedParams));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/settings/integrations/microsoft_365?approved=1");
    expect(mocks.consumeWorkspaceOauthState).toHaveBeenCalledWith("state-abc");
    expect(mocks.upsertFirmApproval).toHaveBeenCalledWith({
      firmId: "org_1",
      provider: "microsoft",
      tenantId: TENANT,
      approvedScopes: MICROSOFT_SCOPES.join(" "),
      approvedByUserId: "user_admin",
    });
    expect(mocks.recordAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.firm_approve",
        firmId: "org_1",
        actorId: "user_admin",
        metadata: { provider: "microsoft", tenantId: TENANT },
      }),
    );
  });

  it("approval with NO session (the IT person): saves, audits as the admin who sent the link, public page", async () => {
    const res = await GET(callback(approvedParams));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/microsoft-approval?result=approved");
    expect(mocks.upsertFirmApproval).toHaveBeenCalledWith(expect.objectContaining({ firmId: "org_1", tenantId: TENANT }));
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.firm_approve", firmId: "org_1", actorId: "user_admin" }),
    );
  });

  it("a session in ANOTHER firm gets the public page, not that firm's settings", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_other", orgId: "org_other" });
    const res = await GET(callback(approvedParams));
    expect(target(res)).toBe("/microsoft-approval?result=approved");
    // The write is still the state's firm, never the session's.
    expect(mocks.upsertFirmApproval).toHaveBeenCalledWith(expect.objectContaining({ firmId: "org_1" }));
  });

  it("error=access_denied → declined, nothing written", async () => {
    const res = await GET(callback({ error: "access_denied", error_description: "AADSTS65004", state: "state-abc" }));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/microsoft-approval?result=declined");
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    // The state is still burnt: a declined link can't be replayed.
    expect(mocks.consumeWorkspaceOauthState).toHaveBeenCalledWith("state-abc");
  });

  it("declined with a same-firm session returns to settings with consent_declined", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1" });
    const res = await GET(callback({ error: "access_denied", state: "state-abc" }));
    expect(target(res)).toBe("/settings/integrations/microsoft_365?error=consent_declined");
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["False", "False"],
  ])("admin_consent %s → declined, nothing written", async (_label, adminConsent) => {
    const params: Record<string, string> = { tenant: TENANT, state: "state-abc" };
    if (adminConsent !== undefined) params.admin_consent = adminConsent;
    const res = await GET(callback(params));
    expect(target(res)).toBe("/microsoft-approval?result=declined");
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
  });

  it("an unknown or expired state → expired, nothing written", async () => {
    mocks.consumeWorkspaceOauthState.mockResolvedValue(null);
    const res = await GET(callback(approvedParams));
    expect(res.status).toBe(307);
    expect(target(res)).toBe("/microsoft-approval?result=expired");
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("an advisor sign-in state (kind user_connect) → expired, nothing written", async () => {
    mocks.consumeWorkspaceOauthState.mockResolvedValue({ ...adminConsentState, kind: "user_connect", codeVerifier: "v" });
    mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1" });
    const res = await GET(callback(approvedParams));
    // An invalid state names no firm, so even a signed-in admin gets the public page.
    expect(target(res)).toBe("/microsoft-approval?result=expired");
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
  });

  it("no state param → expired, and nothing is consumed", async () => {
    const res = await GET(callback({ tenant: TENANT, admin_consent: "True" }));
    expect(target(res)).toBe("/microsoft-approval?result=expired");
    expect(mocks.consumeWorkspaceOauthState).not.toHaveBeenCalled();
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
  });

  // Ruling R5: Entra tenant ids are GUIDs. `common`/`organizations` are the
  // multi-tenant aliases and would save an approval no advisor can sign in to.
  it.each([
    ["common", "common"],
    ["organizations", "organizations"],
    ["empty", ""],
    ["garbage", "not-a-guid"],
    ["a GUID with a suffix", `${TENANT}/x`],
  ])("tenant %s → expired, nothing written", async (_label, tenant) => {
    const res = await GET(callback({ ...approvedParams, tenant }));
    expect(target(res)).toBe("/microsoft-approval?result=expired");
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("saves an upper-case tenant GUID lower-cased, the form id_tokens carry", async () => {
    await GET(callback({ ...approvedParams, tenant: TENANT.toUpperCase() }));
    expect(mocks.upsertFirmApproval).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }));
  });

  it("a non-GUID tenant with a same-firm session returns to settings with consent_expired", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_admin", orgId: "org_1" });
    const res = await GET(callback({ ...approvedParams, tenant: "common" }));
    expect(target(res)).toBe("/settings/integrations/microsoft_365?error=consent_expired");
    expect(mocks.upsertFirmApproval).not.toHaveBeenCalled();
  });

  it("a failed save is a generic 500 that logs only the error's class", async () => {
    mocks.upsertFirmApproval.mockRejectedValue(new Error(`insert failed: params ${TENANT}, state-abc`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(callback(approvedParams));
    expect(res.status).toBe(500);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(consoleError).toHaveBeenCalled();
    expect(logged).not.toContain(TENANT);
    expect(logged).not.toContain("state-abc");
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
