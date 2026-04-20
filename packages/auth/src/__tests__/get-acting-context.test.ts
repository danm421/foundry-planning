import { describe, it, expect, vi } from "vitest";
import { getActingContext } from "../get-acting-context";
import type { AdminUserRepo, AdminUserRow } from "../admin-user-repo";

function makeRepo(overrides: Partial<AdminUserRepo> = {}): AdminUserRepo {
  return {
    findByClerkUserId: vi.fn().mockResolvedValue(null),
    createFromClerk: vi.fn(),
    findActiveImpersonation: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const baseRow: AdminUserRow = {
  id: "admin-uuid",
  clerkUserId: "clerk_abc",
  email: "dan@foundry.test",
  role: "superadmin",
  disabledAt: null,
};

describe("getActingContext", () => {
  it("throws when no Clerk session is present", async () => {
    const repo = makeRepo();
    await expect(
      getActingContext({
        clerkSession: null,
        repo,
      }),
    ).rejects.toThrow(/not authenticated/i);
  });

  it("throws 403-style when the admin is disabled", async () => {
    const repo = makeRepo({
      findByClerkUserId: vi
        .fn()
        .mockResolvedValue({ ...baseRow, disabledAt: new Date() }),
    });
    await expect(
      getActingContext({
        clerkSession: { userId: "clerk_abc", emailAddress: "x@y" },
        repo,
      }),
    ).rejects.toThrow(/disabled/i);
  });

  it("lazy-creates admin_users row when webhook hasn't fired", async () => {
    const createFromClerk = vi.fn().mockResolvedValue(baseRow);
    const repo = makeRepo({
      findByClerkUserId: vi.fn().mockResolvedValue(null),
      createFromClerk,
    });
    const ctx = await getActingContext({
      clerkSession: {
        userId: "clerk_abc",
        emailAddress: "dan@foundry.test",
        role: "superadmin",
      },
      repo,
    });
    expect(createFromClerk).toHaveBeenCalledWith({
      clerkUserId: "clerk_abc",
      email: "dan@foundry.test",
      role: "superadmin",
    });
    expect(ctx.actorAdminId).toBe("admin-uuid");
    expect(ctx.impersonation).toBeNull();
  });

  it("throws when Clerk publicMetadata lacks an admin role", async () => {
    const repo = makeRepo({
      findByClerkUserId: vi.fn().mockResolvedValue(null),
    });
    await expect(
      getActingContext({
        clerkSession: {
          userId: "clerk_abc",
          emailAddress: "dan@foundry.test",
          role: undefined,
        },
        repo,
      }),
    ).rejects.toThrow(/missing admin role/i);
  });

  it("attaches active impersonation session when present", async () => {
    const repo = makeRepo({
      findByClerkUserId: vi.fn().mockResolvedValue(baseRow),
      findActiveImpersonation: vi.fn().mockResolvedValue({
        sessionId: "sess-1",
        advisorClerkUserId: "user_advisor",
        firmId: "firm_42",
      }),
    });
    const ctx = await getActingContext({
      clerkSession: { userId: "clerk_abc", emailAddress: "dan@foundry.test" },
      repo,
    });
    expect(ctx.impersonation).toEqual({
      sessionId: "sess-1",
      advisorClerkUserId: "user_advisor",
      firmId: "firm_42",
    });
  });
});
