import { describe, it, expect, vi, beforeEach } from "vitest";
import { clients, portalBindings } from "@/db/schema";

type BindingRow = { id: string; clerkUserId: string; status: string };

// The `clients` lookup's answer.
let clientRows: { firmId: string; existing: string | null }[] = [];

// The `portal_bindings` lookup's answer, one entry per read. The LAST entry
// repeats, so a steady-state test sets one and a race test sets two: the
// second entry is what the retry loop sees after another writer moved the
// household's rows underneath it.
let bindingReads: BindingRow[][] = [[]];

// Rows the pending -> active UPDATE reports back. Empty means it matched
// nothing (someone else moved the row between the read and the write).
let promoteReturns: { id: string }[] = [{ id: "binding-1" }];

const insertValuesMock = vi.fn();
const updateSetMock = vi.fn();
const selectFromMock = vi.fn();

vi.mock("@/db", () => {
  // Drizzle builders are thenables: the production code awaits some chains
  // where they end (`.where(...)`) and continues others (`.limit(1)`,
  // `.returning(...)`), so every step both continues and resolves.
  const settled = (rows: () => unknown) => ({
    limit: () => settled(rows),
    returning: () => settled(rows),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(rows).then(res, rej),
  });
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => settled(() => selectFromMock(table)),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: unknown) => insertValuesMock(table, values),
      }),
      update: (table: unknown) => ({
        set: (values: unknown) => ({
          where: () => settled(() => updateSetMock(table, values)),
        }),
      }),
    },
  };
});

const recordAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

import { bindClerkUserToClient } from "@/lib/portal/bind-portal-user";

/** A live-index unique violation, shaped the way Drizzle rethrows one. */
const duplicate = () =>
  Object.assign(new Error("duplicate key value"), { cause: { code: "23505" } });

beforeEach(() => {
  // Default fixture: a real household, no legacy column, no binding rows.
  clientRows = [{ firmId: "org_1", existing: null }];
  bindingReads = [[]];
  promoteReturns = [{ id: "binding-1" }];

  insertValuesMock.mockReset();
  updateSetMock.mockReset();
  selectFromMock.mockReset();
  recordAudit.mockClear();

  selectFromMock.mockImplementation((table: unknown) =>
    table === clients
      ? clientRows
      : bindingReads.length > 1
        ? bindingReads.shift()
        : bindingReads[0],
  );
  updateSetMock.mockImplementation((table: unknown) =>
    table === portalBindings ? promoteReturns : [],
  );
});

describe("bindClerkUserToClient", () => {
  it("writes an active portal_bindings row and the legacy column, and audits", async () => {
    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(insertValuesMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({
        clientId: "client-1",
        clerkUserId: "user_xyz",
        status: "active",
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      clients,
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

  it("returns client_not_found when no client row exists", async () => {
    clientRows = [];
    const res = await bindClerkUserToClient("missing", "user_xyz", "webhook");
    expect(res).toEqual({ ok: false, reason: "client_not_found" });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("is a silent no-op when the pair already holds an active binding", async () => {
    clientRows = [{ firmId: "org_1", existing: "user_xyz" }];
    bindingReads = [[{ id: "b1", clerkUserId: "user_xyz", status: "active" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "webhook");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses when a DIFFERENT login holds an active binding (anti-hijack)", async () => {
    bindingReads = [[{ id: "b1", clerkUserId: "user_other", status: "active" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");

    expect(res).toEqual({ ok: false, reason: "already_bound_other" });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("refuses when a DIFFERENT login holds a PENDING binding (anti-hijack)", async () => {
    bindingReads = [[{ id: "b1", clerkUserId: "user_other", status: "pending" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");

    expect(res).toEqual({ ok: false, reason: "already_bound_other" });
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("refuses when the legacy column names another login that has no binding row at all", async () => {
    // The missing-0263-backfill household: the legacy column is the only
    // record of that login's access, and the dual-read still serves them.
    clientRows = [{ firmId: "org_1", existing: "user_other" }];
    bindingReads = [[]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");

    expect(res).toEqual({ ok: false, reason: "already_bound_other" });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("re-invites the SAME login after a revoke: writes a fresh active row", async () => {
    // Revoking leaves the legacy column naming the revoked login on purpose
    // (the dual-read fallback depends on it), so the column cannot be what
    // decides whether this pair is bound.
    clientRows = [{ firmId: "org_1", existing: "user_xyz" }];
    bindingReads = [[{ id: "b1", clerkUserId: "user_xyz", status: "revoked" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "webhook");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(insertValuesMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({ clerkUserId: "user_xyz", status: "active" }),
    );
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("refuses the SELF-HEAL after a revoke, so an automatic bind cannot undo the client's own act", async () => {
    // Same fixture as the webhook test above, one argument different. The
    // advisor re-inviting is a human act of consent; `src/proxy.ts` calling
    // this on every org-less request is not, and it must never resurrect the
    // binding a client just ended from their own Settings screen.
    clientRows = [{ firmId: "org_1", existing: "user_xyz" }];
    bindingReads = [[{ id: "b1", clerkUserId: "user_xyz", status: "revoked" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");

    expect(res).toEqual({ ok: false, reason: "revoked" });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("does not let a DECLINED row block the self-heal", async () => {
    // `declined` only ever comes from `pending` — a proposal from a firm that
    // never had access. Blocking on it would break the one path the self-heal
    // exists for: an invitation whose webhook failed to deliver.
    bindingReads = [[{ id: "b1", clerkUserId: "user_xyz", status: "declined" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "self-heal");

    expect(res.ok).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({ status: "active" }),
    );
  });

  it("does not let ANOTHER login's revoked row block the self-heal", async () => {
    // Only the SAME (household, login) pair carries a deliberate act by this
    // client. Someone else's ended binding says nothing about theirs.
    clientRows = [{ firmId: "org_1", existing: "user_old" }];
    bindingReads = [[{ id: "b1", clerkUserId: "user_old", status: "revoked" }]];

    const res = await bindClerkUserToClient("client-1", "user_new", "self-heal");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(insertValuesMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({ clerkUserId: "user_new", status: "active" }),
    );
  });

  it("re-invites a NEW login after the previous one was revoked", async () => {
    clientRows = [{ firmId: "org_1", existing: "user_old" }];
    bindingReads = [[{ id: "b1", clerkUserId: "user_old", status: "revoked" }]];

    const res = await bindClerkUserToClient("client-1", "user_new", "webhook");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(insertValuesMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({ clerkUserId: "user_new", status: "active" }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      clients,
      expect.objectContaining({ clerkUserId: "user_new" }),
    );
  });

  it("does not treat a declined row as a live binding", async () => {
    bindingReads = [[{ id: "b1", clerkUserId: "user_xyz", status: "declined" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "webhook");

    expect(res.ok).toBe(true);
    expect(insertValuesMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({ status: "active" }),
    );
  });

  it("promotes this pair's PENDING row to active instead of reporting a lockout", async () => {
    bindingReads = [[{ id: "b1", clerkUserId: "user_xyz", status: "pending" }]];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "webhook");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(updateSetMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({ status: "active", acceptedAt: expect.any(Date) }),
    );
    // The live index would reject an insert alongside the pending row.
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(
      clients,
      expect.objectContaining({ clerkUserId: "user_xyz" }),
    );
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("re-reads when the pending row is moved out from under the promotion", async () => {
    // A concurrent decline lands between the read and the UPDATE: the
    // UPDATE matches nothing, the loop re-reads, and the now-declined row
    // leaves the pair free to take a fresh active row.
    bindingReads = [
      [{ id: "b1", clerkUserId: "user_xyz", status: "pending" }],
      [{ id: "b1", clerkUserId: "user_xyz", status: "declined" }],
    ];
    promoteReturns = [];

    const res = await bindClerkUserToClient("client-1", "user_xyz", "webhook");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(insertValuesMock).toHaveBeenCalledWith(
      portalBindings,
      expect.objectContaining({ status: "active" }),
    );
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("finishes an interrupted bind: a duplicate insert re-reads and completes the legacy write", async () => {
    // A previous delivery inserted the active row and then failed before
    // the legacy column was written, so `existing` is still null here.
    bindingReads = [[], [{ id: "b1", clerkUserId: "user_xyz", status: "active" }]];
    insertValuesMock.mockRejectedValueOnce(duplicate());

    const res = await bindClerkUserToClient("client-1", "user_xyz", "webhook");

    expect(res).toEqual({ ok: true, clientId: "client-1", firmId: "org_1" });
    expect(updateSetMock).toHaveBeenCalledWith(
      clients,
      expect.objectContaining({ clerkUserId: "user_xyz" }),
    );
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("rethrows an insert failure that is not a unique violation", async () => {
    insertValuesMock.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      bindClerkUserToClient("client-1", "user_xyz", "webhook"),
    ).rejects.toThrow("connection reset");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("throws rather than reporting success when the bind never settles", async () => {
    // Every insert collides and every re-read still shows no row: the
    // function must never claim ok:true without an active row behind it.
    insertValuesMock.mockRejectedValue(duplicate());

    await expect(
      bindClerkUserToClient("client-1", "user_xyz", "webhook"),
    ).rejects.toThrow(/settle/);
    expect(updateSetMock).not.toHaveBeenCalledWith(clients, expect.anything());
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
