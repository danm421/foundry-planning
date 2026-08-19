import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const getOrganizationMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  clerkClient: async () => ({
    organizations: { getOrganization: (a: unknown) => getOrganizationMock(a) },
  }),
}));

const headerGet = vi.fn();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve({ get: headerGet }) }));

// Both accessors ride the SAME row, exactly as the real module does — so a
// test cannot pass by satisfying one and starving the other.
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

const requireClientEditAccessMock = vi.fn();
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: (id: string) => requireClientEditAccessMock(id),
}));

import { resolvePortalClient } from "../resolve-portal-client";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import type { EntitlementOverride } from "@/lib/billing/entitlements";

/**
 * The entitlement gate is deliberately NOT mocked here: these tests drive the
 * real `requireClientPortalAccess` through its own leaves (the binding row,
 * Clerk's firm metadata, the override rows). Mocking the gate would only prove
 * that a mock was called.
 */
function bindPortalUser(entitlements: string[], advisorId = "u_advisor") {
  authMock.mockResolvedValue({ userId: "u_client", orgId: null });
  getPortalClientRefMock.mockResolvedValue({
    id: "client-1",
    firmId: "org_firm",
    advisorId,
  });
  getOrganizationMock.mockResolvedValue({ publicMetadata: { entitlements } });
}

/** Answer for ONE user id only — `mockResolvedValue` would prove nothing about
 *  WHICH user the gate asked about. */
function overridesForOnly(clerkUserId: string, rows: EntitlementOverride[]) {
  getActiveUserOverridesMock.mockImplementation(async (_f: string, u: string) =>
    u === clerkUserId ? rows : [],
  );
}

const GRANT: EntitlementOverride[] = [{ entitlement: "client_portal", mode: "grant" }];
const REVOKE: EntitlementOverride[] = [{ entitlement: "client_portal", mode: "revoke" }];

beforeEach(() => {
  authMock.mockReset();
  headerGet.mockReset();
  getOrganizationMock.mockReset();
  getPortalClientRefMock.mockReset();
  requireClientEditAccessMock.mockReset();
  getActiveUserOverridesMock.mockReset();
  getActiveUserOverridesMock.mockResolvedValue([]);
});

describe("resolvePortalClient", () => {
  it("throws UnauthorizedError when no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("client session → binding clientId, mode=client, header ignored", async () => {
    bindPortalUser(["client_portal"]);
    headerGet.mockReturnValue("client-EVIL"); // present, must be ignored
    await expect(resolvePortalClient()).resolves.toEqual({
      clientId: "client-1",
      mode: "client",
      clerkUserId: "u_client",
    });
    expect(requireClientEditAccessMock).not.toHaveBeenCalled();
  });

  it("client session with no binding → ForbiddenError", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientRefMock.mockResolvedValue(null);
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("advisor + valid header + edit access → mode=advisor", async () => {
    authMock.mockResolvedValue({ userId: "u_adv", orgId: "org_1" });
    headerGet.mockReturnValue("client-9");
    requireClientEditAccessMock.mockResolvedValue({ firmId: "org_1" });
    await expect(resolvePortalClient()).resolves.toEqual({
      clientId: "client-9",
      mode: "advisor",
      clerkUserId: "u_adv",
    });
    expect(requireClientEditAccessMock).toHaveBeenCalledWith("client-9");
  });

  it("advisor without header → ForbiddenError, never checks access", async () => {
    authMock.mockResolvedValue({ userId: "u_adv", orgId: "org_1" });
    headerGet.mockReturnValue(null);
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
    expect(requireClientEditAccessMock).not.toHaveBeenCalled();
  });

  it("advisor + header for non-owned/view-only client → propagates ForbiddenError", async () => {
    authMock.mockResolvedValue({ userId: "u_adv", orgId: "org_1" });
    headerGet.mockReturnValue("client-x");
    requireClientEditAccessMock.mockRejectedValue(new ForbiddenError("Edit access required"));
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

/**
 * R3 — the portal API is inside the kill switch, not beside it.
 *
 * These are the mobile app's routes. A binding-only resolver answered "who is
 * this?" and never "may they?", so an ops revoke darkened the web pages while
 * `/api/portal/*` stayed fully readable and writable.
 */
describe("resolvePortalClient — client_portal is enforced on the API too", () => {
  it("denies a bound client whose firm lacks the entitlement", async () => {
    bindPortalUser(["ai_import", "ai_forge"]);
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("denies a bound client whose OWNING ADVISOR is revoked by a per-user override", async () => {
    bindPortalUser(["client_portal"]);
    overridesForOnly("u_advisor", REVOKE);
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("admits a client whose firm is OFF but whose advisor is granted", async () => {
    bindPortalUser([]);
    overridesForOnly("u_advisor", GRANT);
    await expect(resolvePortalClient()).resolves.toMatchObject({
      clientId: "client-1",
      mode: "client",
    });
  });

  it("resolves the entitlement against the ADVISOR, not the client's own user id", async () => {
    bindPortalUser([]);
    overridesForOnly("u_client", GRANT); // the grant is on the wrong person
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when the bound client has no firm", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientRefMock.mockResolvedValue({
      id: "client-1",
      firmId: null,
      advisorId: "u_advisor",
    });
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when the bound client has no advisor", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientRefMock.mockResolvedValue({
      id: "client-1",
      firmId: "org_firm",
      advisorId: "",
    });
    getOrganizationMock.mockResolvedValue({ publicMetadata: { entitlements: ["client_portal"] } });
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(ForbiddenError);
  });
});
