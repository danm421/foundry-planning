import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const getOrganizationMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  clerkClient: async () => ({
    organizations: { getOrganization: (a: unknown) => getOrganizationMock(a) },
  }),
}));

const getPortalClientRefMock = vi.fn();
vi.mock("@/lib/portal/get-portal-client", () => ({
  getPortalClientRef: (uid: string) => getPortalClientRefMock(uid),
  getPortalClientId: async (uid: string) => (await getPortalClientRefMock(uid))?.id ?? null,
}));

const getActiveUserOverridesMock = vi.fn();
vi.mock("@/lib/entitlements/user-overrides", () => ({
  getActiveUserOverrides: (f: string, u: string) => getActiveUserOverridesMock(f, u),
  getActiveUserOverridesForFirm: async () => new Map(),
}));

import {
  requireClientPortalAccess,
  requireClientPortalEntitlement,
  currentUserHasClientPortal,
  ForbiddenError,
} from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

/** A bound portal user whose firm carries the given entitlements. */
function bindPortalUser(entitlements: string[], advisorId = "u_advisor") {
  authMock.mockResolvedValue({ userId: "u_client", orgId: null });
  getPortalClientRefMock.mockResolvedValue({
    id: "client-1",
    firmId: "org_firm",
    advisorId,
  });
  getOrganizationMock.mockResolvedValue({ publicMetadata: { entitlements } });
}

beforeEach(() => {
  authMock.mockReset();
  getPortalClientRefMock.mockReset();
  getOrganizationMock.mockReset();
  getActiveUserOverridesMock.mockReset();
  getActiveUserOverridesMock.mockResolvedValue([]);
});

describe("requireClientPortalAccess", () => {
  it("throws UnauthorizedError when no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError when user is an org member (advisor)", async () => {
    authMock.mockResolvedValue({ userId: "u1", orgId: "org_advisor" });
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when user has no client binding", async () => {
    authMock.mockResolvedValue({ userId: "u1", orgId: null });
    getPortalClientRefMock.mockResolvedValue(null);
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns clientId + clerkUserId for a bound portal user whose firm is entitled", async () => {
    bindPortalUser(["ai_import", "client_portal"]);
    const result = await requireClientPortalAccess();
    expect(result).toEqual({ clientId: "client-1", clerkUserId: "u_client" });
  });
});

describe("requireClientPortalAccess — client_portal entitlement gate", () => {
  it("locks out an already-bound portal user when the firm lacks the entitlement", async () => {
    // The whole point of "fully dark": an existing binding is not grandfathered.
    bindPortalUser(["ai_import", "ai_forge"]);
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when the firm's Clerk metadata carries no entitlements array", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientRefMock.mockResolvedValue({
      id: "client-1",
      firmId: "org_firm",
      advisorId: "u_advisor",
    });
    getOrganizationMock.mockResolvedValue({ publicMetadata: {} });
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when the client has no firm", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientRefMock.mockResolvedValue({
      id: "client-1",
      firmId: null,
      advisorId: "u_advisor",
    });
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
    expect(getOrganizationMock).not.toHaveBeenCalled();
  });
});

const GRANT = [{ entitlement: "client_portal", mode: "grant" as const }];
const REVOKE = [{ entitlement: "client_portal", mode: "revoke" as const }];

describe("requireClientPortalAccess — A1: the client follows their own advisor", () => {
  it("lets a client in when the firm is OFF but their advisor is granted", async () => {
    bindPortalUser([]);
    getActiveUserOverridesMock.mockResolvedValue(GRANT);
    await expect(requireClientPortalAccess()).resolves.toEqual({
      clientId: "client-1",
      clerkUserId: "u_client",
    });
  });

  it("locks a client out when the firm is ON but their advisor is revoked", async () => {
    bindPortalUser(["client_portal"]);
    getActiveUserOverridesMock.mockResolvedValue(REVOKE);
    await expect(requireClientPortalAccess()).rejects.toThrow(ForbiddenError);
  });

  it("resolves against the CLIENT'S advisor, not the client's own user id", async () => {
    bindPortalUser([], "u_advisor");
    getActiveUserOverridesMock.mockImplementation(async (_f: string, u: string) =>
      u === "u_advisor" ? GRANT : [],
    );
    await expect(requireClientPortalAccess()).resolves.toMatchObject({
      clientId: "client-1",
    });
    expect(getActiveUserOverridesMock).toHaveBeenCalledWith("org_firm", "u_advisor");
  });

  it("fails closed when the client has no advisor", async () => {
    bindPortalUser(["client_portal"], "");
    await expect(requireClientPortalAccess()).rejects.toThrow(ForbiddenError);
  });

  it("follows the firm when the advisor has no override, in both directions", async () => {
    bindPortalUser(["client_portal"]);
    await expect(requireClientPortalAccess()).resolves.toMatchObject({
      clientId: "client-1",
    });
    bindPortalUser([]);
    await expect(requireClientPortalAccess()).rejects.toThrow(ForbiddenError);
  });
});

describe("requireClientPortalEntitlement — the advisor-side gate", () => {
  /** An advisor acting inside their own org, whose org metadata rides the session. */
  function bindAdvisor(entitlements: string[]) {
    authMock.mockResolvedValue({
      userId: "u_advisor",
      orgId: "org_firm",
      sessionClaims: { org_public_metadata: { entitlements } },
    });
  }

  it("allows a granted advisor at a firm with no firm-level grant", async () => {
    bindAdvisor([]);
    getActiveUserOverridesMock.mockResolvedValue(GRANT);
    await expect(requireClientPortalEntitlement("org_firm")).resolves.toBeUndefined();
  });

  it("blocks a revoked advisor at a firm that has the grant", async () => {
    bindAdvisor(["client_portal"]);
    getActiveUserOverridesMock.mockResolvedValue(REVOKE);
    await expect(requireClientPortalEntitlement("org_firm")).rejects.toThrow(ForbiddenError);
  });

  it("resolves against the CALLER, not some other member", async () => {
    bindAdvisor([]);
    getActiveUserOverridesMock.mockImplementation(async (_f: string, u: string) =>
      u === "u_other" ? GRANT : [],
    );
    await expect(requireClientPortalEntitlement("org_firm")).rejects.toThrow(ForbiddenError);
  });

  it("scopes the lookup to the OWNING firm for a shared cross-firm client", async () => {
    bindAdvisor(["client_portal"]);
    getOrganizationMock.mockResolvedValue({ publicMetadata: { entitlements: [] } });
    await expect(requireClientPortalEntitlement("org_other")).rejects.toThrow(ForbiddenError);
    expect(getActiveUserOverridesMock).toHaveBeenCalledWith("org_other", "u_advisor");
  });

  it("throws UnauthorizedError with no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    await expect(requireClientPortalEntitlement("org_firm")).rejects.toThrow(UnauthorizedError);
  });
});

describe("currentUserHasClientPortal", () => {
  it("is true for a granted advisor at a firm with no firm-level grant", async () => {
    authMock.mockResolvedValue({
      userId: "u_advisor",
      orgId: "org_firm",
      sessionClaims: { org_public_metadata: { entitlements: [] } },
    });
    getActiveUserOverridesMock.mockResolvedValue(GRANT);
    expect(await currentUserHasClientPortal()).toBe(true);
  });

  it("is false for a revoked advisor at a firm that has the grant", async () => {
    authMock.mockResolvedValue({
      userId: "u_advisor",
      orgId: "org_firm",
      sessionClaims: { org_public_metadata: { entitlements: ["client_portal"] } },
    });
    getActiveUserOverridesMock.mockResolvedValue(REVOKE);
    expect(await currentUserHasClientPortal()).toBe(false);
  });

  it("is false with no org", async () => {
    authMock.mockResolvedValue({ userId: "u_advisor", orgId: null });
    expect(await currentUserHasClientPortal()).toBe(false);
  });
});
