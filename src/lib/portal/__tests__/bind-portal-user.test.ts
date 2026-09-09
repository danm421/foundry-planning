import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValuesMock = vi.fn();
const updateSetMock = vi.fn();
const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (vals: unknown) => insertValuesMock(vals),
    }),
    update: () => ({
      set: (vals: unknown) => ({ where: () => updateSetMock(vals) }),
    }),
    select: () => ({
      from: () => ({ where: () => ({ limit: () => selectChain() }) }),
    }),
  },
}));

const recordAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

import { bindClerkUserToClient } from "@/lib/portal/bind-portal-user";

// Default fixture backing `selectChain`: a client row with clerkUserId null
// (`existing: existingClerkUserId`, read live at call time, not snapshotted —
// so a test can mutate this between arranging state and calling the
// function under test without re-stubbing `selectChain` itself).
let existingClerkUserId: string | null = null;

beforeEach(() => {
  existingClerkUserId = null;
  insertValuesMock.mockReset();
  updateSetMock.mockReset();
  selectChain.mockReset();
  selectChain.mockImplementation(() =>
    Promise.resolve([{ firmId: "org_1", existing: existingClerkUserId }]),
  );
  recordAudit.mockClear();
});

describe("bindClerkUserToClient", () => {
  it("writes clerk_user_id and audits when the client is unbound", async () => {
    selectChain.mockResolvedValue([{ firmId: "firm-1", existing: null }]);
    updateSetMock.mockResolvedValue([]);
    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");
    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "firm-1" });
    expect(updateSetMock).toHaveBeenCalledWith(
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
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses to rebind a client owned by a DIFFERENT user (anti-hijack)", async () => {
    selectChain.mockResolvedValue([{ firmId: "firm-1", existing: "user_other" }]);
    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");
    expect(res).toEqual({ ok: false, reason: "already_bound_other" });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns client_not_found when no client row exists", async () => {
    selectChain.mockResolvedValue([]);
    const res = await bindClerkUserToClient("missing", "user_xyz", "webhook");
    expect(res).toEqual({ ok: false, reason: "client_not_found" });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("writes an active portal_bindings row as well as the legacy column", async () => {
    // Default fixture: a client row with clerkUserId null.
    const result = await bindClerkUserToClient("client-1", "user_1", "webhook");
    expect(result).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        clerkUserId: "user_1",
        status: "active",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_1" }),
    );
  });

  it("is idempotent — a repeat bind writes no second binding row", async () => {
    existingClerkUserId = "user_1";
    insertValuesMock.mockClear();
    const result = await bindClerkUserToClient("client-1", "user_1", "webhook");
    expect(result.ok).toBe(true);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("tolerates a duplicate-insert race on retry: the legacy column still gets written", async () => {
    // A prior attempt's insert already landed (the live client+user pair
    // already has an active portal_bindings row) but its legacy-column
    // update failed, so `existing` is still null on this retry — distinct
    // from the "already bound to this user" idempotency case above, which
    // never reaches the insert at all.
    insertValuesMock.mockRejectedValueOnce(
      Object.assign(new Error("duplicate"), { cause: { code: "23505" } }),
    );
    const result = await bindClerkUserToClient("client-1", "user_1", "webhook");
    expect(result).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_1" }),
    );
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });
});
