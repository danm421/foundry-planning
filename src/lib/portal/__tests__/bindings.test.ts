import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A chainable `db.select()` mock: every step (`from`/`innerJoin`/`where`/
 * `orderBy`/`limit`) returns the same chain object, and the chain itself is
 * thenable — awaiting it at ANY point shifts the next row-set off `queue`.
 * That matches every shape this module's queries take: some end in
 * `.orderBy()` (the two list functions), others in `.limit()` after an
 * optional `.orderBy()` (the point lookups) — one shared queue slot is
 * consumed per query, in call order, regardless of chain length.
 */
let queue: unknown[][] = [];
const selectFrom = vi.fn();
const insertValues = vi.fn();
const updateSet = vi.fn();
const updateWhere = vi.fn();

const selectChain = {
  from: (...a: unknown[]) => {
    selectFrom(...a);
    return selectChain;
  },
  innerJoin: () => selectChain,
  where: () => selectChain,
  orderBy: () => selectChain,
  limit: () => selectChain,
  then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    Promise.resolve(queue.shift() ?? []).then(resolve, reject);
  },
};

vi.mock("@/db", () => ({
  db: {
    select: () => selectChain,
    insert: () => ({
      values: (vals: unknown) => {
        insertValues(vals);
        return { returning: () => Promise.resolve(queue.shift() ?? []) };
      },
    }),
    update: () => ({
      set: (vals: unknown) => {
        updateSet(vals);
        return {
          where: (...a: unknown[]) => {
            updateWhere(...a);
            return Promise.resolve(undefined);
          },
        };
      },
    }),
  },
}));

const recordAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => recordAudit(...a) }));

import {
  REQUEST_TTL_DAYS,
  DECLINE_COOLDOWN_DAYS,
  isExpired,
  cooldownEndsAt,
  listActiveBindings,
  listPendingRequests,
  createPendingBinding,
  acceptBinding,
  declineBinding,
  revokeBinding,
  getActiveBindingClerkUserId,
} from "@/lib/portal/bindings";

beforeEach(() => {
  queue = [];
  selectFrom.mockClear();
  insertValues.mockClear();
  updateSet.mockClear();
  updateWhere.mockClear();
  recordAudit.mockClear();
});

describe("binding policy", () => {
  it("expires a pending request after the TTL", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 1000);
    expect(isExpired(past)).toBe(true);
    expect(isExpired(future)).toBe(false);
  });

  it("treats a null expiry as never expiring", () => {
    // Invitation-path rows carry no expiry; they are not requests.
    expect(isExpired(null)).toBe(false);
  });

  it("blocks a re-request for 30 days after a decline", () => {
    const declinedAt = new Date("2026-03-01T00:00:00Z");
    expect(cooldownEndsAt(declinedAt).toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("uses a 14-day request TTL and a 30-day decline cooldown", () => {
    expect(REQUEST_TTL_DAYS).toBe(14);
    expect(DECLINE_COOLDOWN_DAYS).toBe(30);
  });
});

describe("listActiveBindings", () => {
  it("skips the query and returns [] for an empty clerkUserId", async () => {
    const result = await listActiveBindings("");
    expect(result).toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it("returns the joined rows for a live login", async () => {
    const acceptedAt = new Date("2026-02-01T00:00:00Z");
    queue = [[{ bindingId: "b1", clientId: "c1", firmId: "firm-1", advisorId: "adv-1", acceptedAt }]];
    const result = await listActiveBindings("user_x");
    expect(result).toEqual([{ bindingId: "b1", clientId: "c1", firmId: "firm-1", advisorId: "adv-1", acceptedAt }]);
  });
});

describe("listPendingRequests", () => {
  it("skips the query and returns [] for an empty clerkUserId", async () => {
    const result = await listPendingRequests("");
    expect(result).toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it("returns the joined pending rows", async () => {
    const expiresAt = new Date("2026-03-01T00:00:00Z");
    queue = [[{ bindingId: "b1", clientId: "c1", firmId: "firm-1", requestedBy: "adv-1", expiresAt }]];
    const result = await listPendingRequests("user_x");
    expect(result).toEqual([{ bindingId: "b1", clientId: "c1", firmId: "firm-1", requestedBy: "adv-1", expiresAt }]);
  });
});

describe("createPendingBinding", () => {
  it("refuses when a pending or active binding already exists", async () => {
    queue = [[{ id: "existing" }]];
    const result = await createPendingBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      requestedBy: "adv-1",
    });
    expect(result).toEqual({ ok: false, reason: "already_live" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("refuses inside the 30-day decline cooldown", async () => {
    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    queue = [[], [{ endedAt: nineDaysAgo }]];
    const result = await createPendingBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      requestedBy: "adv-1",
    });
    expect(result).toEqual({ ok: false, reason: "recently_declined" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("succeeds once the 30-day decline cooldown has passed", async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    queue = [[], [{ endedAt: thirtyOneDaysAgo }], [{ id: "new-binding" }]];
    const before = Date.now();
    const result = await createPendingBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      requestedBy: "adv-1",
      ttlDays: 5,
    });
    expect(result).toEqual({ ok: true, bindingId: "new-binding" });
    expect(insertValues).toHaveBeenCalledTimes(1);
    const written = insertValues.mock.calls[0][0] as { expiresAt: Date; status: string };
    expect(written.status).toBe("pending");
    const expectedExpiry = before + 5 * 24 * 60 * 60 * 1000;
    expect(Math.abs(written.expiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);
    // No audit at row-creation: the email-transport task audits AFTER a
    // successful send, not here — auditing both would claim a request was
    // made even when the email never went out.
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("succeeds when the household has never declined this login", async () => {
    queue = [[], [], [{ id: "fresh-binding" }]];
    const result = await createPendingBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      requestedBy: "adv-1",
    });
    expect(result).toEqual({ ok: true, bindingId: "fresh-binding" });
  });
});

describe("acceptBinding", () => {
  it("promotes a pending row to active and audits it", async () => {
    const future = new Date(Date.now() + 1000);
    queue = [[{ clientId: "c1", status: "pending", expiresAt: future, firmId: "firm-1" }]];
    const result = await acceptBinding("b1", "user_x");
    expect(result).toEqual({ ok: true, clientId: "c1" });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.access.accepted",
        clientId: "c1",
        firmId: "firm-1",
        actorId: "user_x",
        actorKind: "client",
      }),
    );
  });

  // THE authorization test: the `clerkUserId` predicate is baked into the
  // same query as the `bindingId` lookup (one `.where(and(...))`, not a
  // fetch-then-check), so a caller whose id doesn't own the row can never
  // observe or act on it — the row simply isn't found.
  it("refuses (not_found) a binding whose clerkUserId is not the caller's", async () => {
    queue = [[]];
    const result = await acceptBinding("b1", "someone_elses_user_id");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(updateSet).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses an expired pending row and leaves it untouched", async () => {
    const past = new Date(Date.now() - 1000);
    queue = [[{ clientId: "c1", status: "pending", expiresAt: past, firmId: "firm-1" }]];
    const result = await acceptBinding("b1", "user_x");
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(updateSet).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses a row that is no longer pending", async () => {
    queue = [[{ clientId: "c1", status: "declined", expiresAt: null, firmId: "firm-1" }]];
    const result = await acceptBinding("b1", "user_x");
    expect(result).toEqual({ ok: false, reason: "not_pending" });
    expect(updateSet).not.toHaveBeenCalled();
  });
});

describe("declineBinding", () => {
  it("declines a pending row and audits it", async () => {
    queue = [[{ clientId: "c1", status: "pending", firmId: "firm-1" }]];
    const result = await declineBinding("b1", "user_x");
    expect(result).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "declined", endedBy: "client" }));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.access.declined", actorKind: "client" }),
    );
  });

  it("refuses (false) when no matching pending row is found", async () => {
    queue = [[]];
    const result = await declineBinding("b1", "user_x");
    expect(result).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("revokeBinding", () => {
  it("writes endedBy exactly as passed — 'client'", async () => {
    queue = [[{ id: "b1", firmId: "firm-1" }]];
    const result = await revokeBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      endedBy: "client",
      actorId: "user_x",
    });
    expect(result).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ endedBy: "client" }));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.access.revoked_by_client", actorKind: "client" }),
    );
  });

  it("writes endedBy exactly as passed — 'advisor' (a swap to 'client' must fail this)", async () => {
    queue = [[{ id: "b2", firmId: "firm-1" }]];
    const result = await revokeBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      endedBy: "advisor",
      actorId: "adv-1",
    });
    expect(result).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ endedBy: "advisor" }));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.access.revoked_by_advisor", actorKind: "advisor", actorId: "adv-1" }),
    );
  });

  it("refuses (false) when there is no active binding to end", async () => {
    queue = [[]];
    const result = await revokeBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      endedBy: "client",
      actorId: "user_x",
    });
    expect(result).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("getActiveBindingClerkUserId", () => {
  it("skips the query and returns null for an empty clientId", async () => {
    const result = await getActiveBindingClerkUserId("");
    expect(result).toBeNull();
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it("returns the clerkUserId of the active binding", async () => {
    queue = [[{ clerkUserId: "user_x" }]];
    const result = await getActiveBindingClerkUserId("c1");
    expect(result).toBe("user_x");
  });

  it("returns null when the household has no active binding", async () => {
    queue = [[]];
    const result = await getActiveBindingClerkUserId("c1");
    expect(result).toBeNull();
  });
});
