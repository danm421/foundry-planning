// Ops access is granted to the account that owns the typed email. Clerk's
// email filter also lists accounts that only added the address, unverified.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getUserListMock, addOpsAdminMock } = vi.hoisted(() => ({
  getUserListMock: vi.fn(),
  addOpsAdminMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUserList: getUserListMock } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ops/ops-auth", () => ({
  requireOpsAdmin: vi.fn(async () => ({ clerkUserId: "user_super" })),
}));
vi.mock("@/lib/ops/ops-admins", () => ({
  addOpsAdmin: addOpsAdminMock,
  updateOpsAdmin: vi.fn(),
  OpsAdminError: class OpsAdminError extends Error {},
}));

import { addOpsAdminAction } from "../actions";

beforeEach(() => vi.clearAllMocks());

describe("addOpsAdminAction", () => {
  it("does not grant ops access to an account that never verified the email", async () => {
    getUserListMock.mockResolvedValue({
      data: [
        {
          id: "user_other",
          primaryEmailAddressId: "e1",
          emailAddresses: [
            { id: "e1", emailAddress: "other@example.test", verification: { status: "verified" } },
            { id: "e2", emailAddress: "ops@example.test", verification: { status: "unverified" } },
          ],
        },
      ],
    });

    const result = await addOpsAdminAction({ email: "ops@example.test", role: "ops" });

    expect(result.ok).toBe(false);
    expect(addOpsAdminMock).not.toHaveBeenCalled();
  });

  it("grants ops access to the verified holder, recorded under their primary email", async () => {
    getUserListMock.mockResolvedValue({
      data: [
        {
          id: "user_ops",
          primaryEmailAddressId: "e1",
          emailAddresses: [
            { id: "e1", emailAddress: "ops@example.test", verification: { status: "verified" } },
          ],
        },
      ],
    });

    const result = await addOpsAdminAction({ email: "ops@example.test", role: "ops" });

    expect(result).toEqual({ ok: true });
    expect(addOpsAdminMock).toHaveBeenCalledWith({
      clerkUserId: "user_ops",
      email: "ops@example.test",
      role: "ops",
      actorId: "user_super",
    });
  });
});
