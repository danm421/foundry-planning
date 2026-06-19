import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const getPortalClientIdMock = vi.fn();
vi.mock("@/lib/portal/get-portal-client", () => ({
  getPortalClientId: (uid: string) => getPortalClientIdMock(uid),
}));

import { requireClientPortalAccess, ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

beforeEach(() => {
  authMock.mockReset();
  getPortalClientIdMock.mockReset();
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
    getPortalClientIdMock.mockResolvedValue(null);
    await expect(requireClientPortalAccess()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns clientId + clerkUserId for a bound portal user", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientIdMock.mockResolvedValue("client-1");
    const result = await requireClientPortalAccess();
    expect(result).toEqual({ clientId: "client-1", clerkUserId: "u_client" });
  });
});
