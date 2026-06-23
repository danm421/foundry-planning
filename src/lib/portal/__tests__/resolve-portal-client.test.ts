import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));

const headerGet = vi.fn();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve({ get: headerGet }) }));

const getPortalClientIdMock = vi.fn();
vi.mock("@/lib/portal/get-portal-client", () => ({
  getPortalClientId: (uid: string) => getPortalClientIdMock(uid),
}));

const requireClientEditAccessMock = vi.fn();
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: (id: string) => requireClientEditAccessMock(id),
}));

import { resolvePortalClient } from "../resolve-portal-client";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

beforeEach(() => {
  authMock.mockReset();
  headerGet.mockReset();
  getPortalClientIdMock.mockReset();
  requireClientEditAccessMock.mockReset();
});

describe("resolvePortalClient", () => {
  it("throws UnauthorizedError when no session", async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null });
    await expect(resolvePortalClient()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("client session → binding clientId, mode=client, header ignored", async () => {
    authMock.mockResolvedValue({ userId: "u_client", orgId: null });
    getPortalClientIdMock.mockResolvedValue("client-1");
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
    getPortalClientIdMock.mockResolvedValue(null);
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
