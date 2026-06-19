import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Auth mocks (real idiom, mirrors invite route) ---
const requireClientEditAccessMock = vi.fn();
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: (id: string) => requireClientEditAccessMock(id),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: async () => {},
  authErrorResponse: () => undefined,
}));

// --- Clerk mock ---
const deleteUserMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "advisor-1", orgId: "firm-1" }),
  clerkClient: async () => ({
    users: { deleteUser: (id: string) => deleteUserMock(id) },
  }),
}));

// --- DB mock ---
const updateChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({ where: () => updateChain(vals) }),
    }),
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "@/app/api/clients/[id]/portal/disable/route";

beforeEach(() => {
  requireClientEditAccessMock.mockReset();
  deleteUserMock.mockReset();
  updateChain.mockReset();
});

describe("POST /api/clients/[id]/portal/disable", () => {
  it("deletes the Clerk user and nulls clerk_user_id", async () => {
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "c1", clerkUserId: "user_xyz" },
    });

    const res = await POST(
      new Request("http://localhost/api/clients/c1/portal/disable", { method: "POST" }),
      { params: Promise.resolve({ id: "c1" }) },
    );

    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledWith("user_xyz");
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: null }),
    );
  });

  it("is a no-op for Clerk delete when no clerk_user_id is set, but still nulls the binding", async () => {
    requireClientEditAccessMock.mockResolvedValue({
      firmId: "firm-1",
      access: "own",
      client: { id: "c1", clerkUserId: null },
    });

    const res = await POST(
      new Request("http://localhost/api/clients/c1/portal/disable", { method: "POST" }),
      { params: Promise.resolve({ id: "c1" }) },
    );

    expect(res.status).toBe(200);
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: null }),
    );
  });
});
