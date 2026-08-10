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

import { requireClientPortalAccess, ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

/** A bound portal user whose firm carries the given entitlements. */
function bindPortalUser(entitlements: string[]) {
  authMock.mockResolvedValue({ userId: "u_client", orgId: null });
  getPortalClientRefMock.mockResolvedValue({ id: "client-1", firmId: "org_firm" });
  getOrganizationMock.mockResolvedValue({ publicMetadata: { entitlements } });
}

beforeEach(() => {
  authMock.mockReset();
  getPortalClientRefMock.mockReset();
  getOrganizationMock.mockReset();
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
    getPortalClientRefMock.mockResolvedValue({ id: "client-1", firmId: "org_firm" });
    getOrganizationMock.mockResolvedValue({ publicMetadata: {} });
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fails closed when the client has no firm", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientRefMock.mockResolvedValue({ id: "client-1", firmId: null });
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
    expect(getOrganizationMock).not.toHaveBeenCalled();
  });
});
