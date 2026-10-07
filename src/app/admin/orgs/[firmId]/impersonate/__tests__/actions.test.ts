// An operator may impersonate an advisor, but never anyone who holds an ops
// console role: borrowing a peer operator's identity would borrow their rank.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  opsRows: [] as Array<{ clerkUserId: string }>,
  startImpersonation: vi.fn(),
}));

vi.mock("@/lib/ops/ops-auth", () => ({
  requireOpsAdmin: async () => ({ clerkUserId: "user_support", email: "op@example.test", role: "support" }),
}));
vi.mock("@/lib/crm-tasks/members", () => ({
  listFirmMembers: async () => [{ userId: "user_advisor" }, { userId: "user_super" }],
}));
vi.mock("@/lib/ops/impersonation", () => ({ startImpersonation: h.startImpersonation }));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => h.opsRows }) }) }) },
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { startImpersonationAction } from "../actions";

const form = (advisorUserId: string) => {
  const f = new FormData();
  f.set("firmId", "org_dummy");
  f.set("advisorUserId", advisorUserId);
  f.set("reason", "support ticket");
  return f;
};

beforeEach(() => {
  h.opsRows = [];
  h.startImpersonation.mockReset().mockResolvedValue("https://clerk.example/sign-in");
});

describe("startImpersonationAction", () => {
  it("refuses a target who holds an ops role", async () => {
    h.opsRows = [{ clerkUserId: "user_super" }];
    await expect(startImpersonationAction(form("user_super"))).rejects.toThrow();
    expect(h.startImpersonation).not.toHaveBeenCalled();
  });

  it("impersonates an advisor with no ops role", async () => {
    await startImpersonationAction(form("user_advisor"));
    expect(h.startImpersonation).toHaveBeenCalledWith(
      expect.objectContaining({ advisorUserId: "user_advisor", opsUserId: "user_support" }),
    );
  });
});
