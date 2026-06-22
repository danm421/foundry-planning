import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUser: (...a: unknown[]) => getUser(...a) } }),
}));

const bindClerkUserToClient = vi.fn();
vi.mock("@/lib/portal/bind-portal-user", () => ({
  bindClerkUserToClient: (...a: unknown[]) => bindClerkUserToClient(...a),
}));

import { claimPortalBinding } from "@/lib/portal/claim-portal-binding";

beforeEach(() => {
  getUser.mockReset();
  bindClerkUserToClient.mockReset();
});

describe("claimPortalBinding", () => {
  it("binds and returns the clientId when user metadata carries a valid clientId", async () => {
    getUser.mockResolvedValue({ publicMetadata: { clientId: "client-1" } });
    bindClerkUserToClient.mockResolvedValue({ ok: true, clientId: "client-1", firmId: "firm-1" });
    const result = await claimPortalBinding("user_xyz");
    expect(result).toBe("client-1");
    expect(bindClerkUserToClient).toHaveBeenCalledWith("client-1", "user_xyz", "self-heal");
  });

  it("returns null and does not bind when metadata has no clientId", async () => {
    getUser.mockResolvedValue({ publicMetadata: {} });
    const result = await claimPortalBinding("user_xyz");
    expect(result).toBeNull();
    expect(bindClerkUserToClient).not.toHaveBeenCalled();
  });

  it("returns null when the writer refuses (e.g. already bound to another user)", async () => {
    getUser.mockResolvedValue({ publicMetadata: { clientId: "client-1" } });
    bindClerkUserToClient.mockResolvedValue({ ok: false, reason: "already_bound_other" });
    const result = await claimPortalBinding("user_xyz");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the Clerk call fails", async () => {
    getUser.mockRejectedValue(new Error("clerk down"));
    const result = await claimPortalBinding("user_xyz");
    expect(result).toBeNull();
  });

  it("returns null for an empty userId without calling Clerk", async () => {
    const result = await claimPortalBinding("");
    expect(result).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
});
