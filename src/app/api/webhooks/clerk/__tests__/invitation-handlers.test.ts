import { describe, it, expect, vi, beforeEach } from "vitest";

const updateChain = vi.fn();
const selectChain = vi.fn();
const bindingsChain = vi.fn();
const insertChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (vals: unknown) => insertChain(vals),
    }),
    update: () => ({
      set: (vals: unknown) => ({
        where: () => updateChain(vals),
      }),
    }),
    select: () => ({
      from: () => ({
        // `bindClerkUserToClient` reads the client row with `.limit(1)` and
        // the household's portal_bindings rows by awaiting `.where(...)`
        // itself, so this step has to answer both.
        where: () => ({
          limit: () => selectChain(),
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(bindingsChain()).then(res, rej),
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
  bindingsChain.mockReset();
  insertChain.mockReset();
  // No binding rows yet: the household is unbound on both stores.
  bindingsChain.mockReturnValue([]);
  insertChain.mockResolvedValue([]);
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

  it("returns 500 when the DB throws during bind (signals Clerk to retry)", async () => {
    selectChain.mockRejectedValue(new Error("db down"));
    const res = await dispatchClerkInvitation({
      type: "invitation.accepted",
      data: {
        public_metadata: { clientId: "client-1" },
        created_user_id: "user_xyz",
      },
    });
    expect(res?.status).toBe(500);
  });
});
