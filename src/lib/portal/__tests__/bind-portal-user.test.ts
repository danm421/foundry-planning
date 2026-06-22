import { describe, it, expect, vi, beforeEach } from "vitest";

const updateChain = vi.fn();
const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({ where: () => updateChain(vals) }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: () => selectChain() }) }),
    }),
  },
}));

const recordAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

import { bindClerkUserToClient } from "@/lib/portal/bind-portal-user";

beforeEach(() => {
  updateChain.mockReset();
  selectChain.mockReset();
  recordAudit.mockClear();
});

describe("bindClerkUserToClient", () => {
  it("writes clerk_user_id and audits when the client is unbound", async () => {
    selectChain.mockResolvedValue([{ firmId: "firm-1", existing: null }]);
    updateChain.mockResolvedValue([]);
    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");
    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "firm-1" });
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_xyz" }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.invite.accepted",
        actorKind: "system",
        actorId: "portal:self-heal",
      }),
    );
  });

  it("is idempotent when already bound to the SAME user (no write, no audit)", async () => {
    selectChain.mockResolvedValue([{ firmId: "firm-1", existing: "user_xyz" }]);
    const res = await bindClerkUserToClient("client-1", "user_xyz", "webhook");
    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "firm-1" });
    expect(updateChain).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses to rebind a client owned by a DIFFERENT user (anti-hijack)", async () => {
    selectChain.mockResolvedValue([{ firmId: "firm-1", existing: "user_other" }]);
    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");
    expect(res).toEqual({ ok: false, reason: "already_bound_other" });
    expect(updateChain).not.toHaveBeenCalled();
  });

  it("returns client_not_found when no client row exists", async () => {
    selectChain.mockResolvedValue([]);
    const res = await bindClerkUserToClient("missing", "user_xyz", "webhook");
    expect(res).toEqual({ ok: false, reason: "client_not_found" });
    expect(updateChain).not.toHaveBeenCalled();
  });
});
