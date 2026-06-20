import { describe, it, expect, vi, beforeEach } from "vitest";

const updateChain = vi.fn();
const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({
        where: () => updateChain(vals),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => selectChain(),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { dispatchClerkInvitation } from "@/app/api/webhooks/clerk/invitation-handlers";

beforeEach(() => {
  updateChain.mockReset();
  selectChain.mockReset();
});

describe("dispatchClerkInvitation", () => {
  it("ignores unrelated event types", async () => {
    const res = await dispatchClerkInvitation({
      type: "user.created",
      data: { id: "u1" },
    });
    expect(res).toBeNull();
  });

  it("writes clerk_user_id when invitation.accepted carries metadata", async () => {
    selectChain.mockResolvedValue([{ firmId: "firm-1" }]);
    updateChain.mockResolvedValue([]);
    const res = await dispatchClerkInvitation({
      type: "invitation.accepted",
      data: {
        public_metadata: { clientId: "client-1" },
        created_user_id: "user_xyz",
      },
    });
    expect(res?.status).toBe(200);
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_xyz" }),
    );
  });

  it("returns 400 when invitation metadata is missing the clientId", async () => {
    const res = await dispatchClerkInvitation({
      type: "invitation.accepted",
      data: { created_user_id: "user_xyz" },
    });
    expect(res?.status).toBe(400);
  });
});
