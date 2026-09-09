import { describe, it, expect, beforeEach, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * A chainable `db.select()` / `db.update()` mock: every step (`from`/
 * `innerJoin`/`where`/`orderBy`/`limit`) returns the same chain object, and
 * the chain itself is thenable — awaiting it at ANY point shifts the next
 * row-set off `queue`. `db.update(...).set(...).where(...)` now always ends
 * in `.returning()`, matching the module's atomic conditional-update shape.
 *
 * Crucially, `where()` and `orderBy()` do NOT discard their arguments — they
 * record the real drizzle `SQL` condition (drizzle-orm and @/db/schema are
 * NOT mocked here, only @/db, so `eq()`/`and()`/`sql` build real SQL AST
 * objects). `compileParams`/`compileSQL` below compile those with a real
 * `PgDialect`, with no live database involved, so tests can prove a
 * predicate is actually present rather than just trusting the mock's answer.
 */
let queue: unknown[][] = [];
let insertRejection: unknown = null;
const selectFrom = vi.fn();
const selectWhereArgs: unknown[] = [];
const selectOrderByArgs: unknown[] = [];
const insertValues = vi.fn();
const updateSet = vi.fn();
const updateWhereArgs: unknown[] = [];
const deleteWhereArgs: unknown[] = [];

const selectChain = {
  from: (...a: unknown[]) => {
    selectFrom(...a);
    return selectChain;
  },
  innerJoin: () => selectChain,
  where: (cond: unknown) => {
    selectWhereArgs.push(cond);
    return selectChain;
  },
  orderBy: (expr: unknown) => {
    selectOrderByArgs.push(expr);
    return selectChain;
  },
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
        return {
          returning: () => {
            if (insertRejection) {
              const err = insertRejection;
              insertRejection = null;
              return Promise.reject(err);
            }
            return Promise.resolve(queue.shift() ?? []);
          },
        };
      },
    }),
    update: () => ({
      set: (vals: unknown) => {
        updateSet(vals);
        return {
          where: (cond: unknown) => {
            updateWhereArgs.push(cond);
            return { returning: () => Promise.resolve(queue.shift() ?? []) };
          },
        };
      },
    }),
    delete: () => ({
      where: (cond: unknown) => {
        deleteWhereArgs.push(cond);
        return { returning: () => Promise.resolve(queue.shift() ?? []) };
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
  listBindingsForUser,
  listPendingRequests,
  createPendingBinding,
  deletePendingBinding,
  acceptBinding,
  declineBinding,
  revokeBinding,
  revokeAllForUser,
  getActiveBindingClerkUserId,
  getPendingRequestForClient,
  getClientDisconnectedAt,
} from "@/lib/portal/bindings";

const dialect = new PgDialect();
/** Compiles a captured drizzle condition/order-by expression with a REAL
 *  PgDialect — no DB connection required — so a test can inspect the actual
 *  bound parameters and SQL text a predicate would send to Postgres. */
function compile(expr: unknown) {
  return dialect.sqlToQuery(expr as SQL);
}

beforeEach(() => {
  queue = [];
  insertRejection = null;
  selectFrom.mockClear();
  selectWhereArgs.length = 0;
  selectOrderByArgs.length = 0;
  insertValues.mockClear();
  updateSet.mockClear();
  updateWhereArgs.length = 0;
  deleteWhereArgs.length = 0;
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

  it("orders NULLS LAST so an unaccepted row can never look most-recent", async () => {
    queue = [[]];
    await listActiveBindings("user_x");
    const compiled = compile(selectOrderByArgs[0]);
    expect(compiled.sql).toContain("NULLS LAST");
  });
});

describe("listBindingsForUser", () => {
  it("skips the query and returns [] for an empty clerkUserId", async () => {
    const result = await listBindingsForUser("");
    expect(result).toEqual([]);
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it("returns rows in ANY status, carrying the status through", async () => {
    const acceptedAt = new Date("2026-02-01T00:00:00Z");
    queue = [
      [
        { bindingId: "b1", clientId: "c1", firmId: "firm-1", advisorId: "adv-1", acceptedAt, status: "revoked" },
      ],
    ];
    const result = await listBindingsForUser("user_x");
    expect(result).toEqual([
      { bindingId: "b1", clientId: "c1", firmId: "firm-1", advisorId: "adv-1", acceptedAt, status: "revoked" },
    ]);
  });

  // The whole point of this query: the dual-read chokepoint uses "zero rows at
  // all" to decide whether the legacy `clients.clerk_user_id` column may be
  // consulted. A status predicate here would hide a revoked user's history and
  // let that column resurrect their access.
  it("does NOT filter by status", async () => {
    queue = [[]];
    await listBindingsForUser("user_x");
    const compiled = compile(selectWhereArgs[0]);
    expect(compiled.params).toEqual(["user_x"]);
    expect(compiled.sql).not.toContain("status");
  });

  it("orders NULLS LAST so an unaccepted row can never look most-recent", async () => {
    queue = [[]];
    await listBindingsForUser("user_x");
    const compiled = compile(selectOrderByArgs[0]);
    expect(compiled.sql).toContain("NULLS LAST");
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

  // Finding 5: isExpired(null) === "never expires", so the list query must
  // not silently drop null-expiry rows — a stale invisible-but-acceptable
  // request would be worse than a visible one.
  it("includes a null-expiry row rather than silently dropping it (matches isExpired's semantics)", async () => {
    queue = [[]];
    await listPendingRequests("user_x");
    const compiled = compile(selectWhereArgs[0]);
    expect(compiled.sql).toContain("is null");
  });
});

describe("createPendingBinding", () => {
  it("refuses when a pending or active binding already exists (fast read path)", async () => {
    queue = [[{ id: "existing" }]];
    const result = await createPendingBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      requestedBy: "adv-1",
    });
    expect(result).toEqual({ ok: false, reason: "already_live" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  // Finding 3: the read-based "live" check can't be the actual gate — two
  // concurrent requests both pass it. The unique index is, so a 23505 raised
  // by the insert itself must map to the same already_live reason instead of
  // throwing.
  it("maps a 23505 unique-violation from the insert to already_live (the create race)", async () => {
    queue = [[], []]; // live check empty, declined check empty — both reads pass
    insertRejection = { code: "23505", constraint: "portal_bindings_live_idx" };
    const result = await createPendingBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      requestedBy: "adv-1",
    });
    expect(result).toEqual({ ok: false, reason: "already_live" });
  });

  it("maps a DrizzleQueryError-wrapped 23505 (code on .cause) the same way", async () => {
    queue = [[], []];
    insertRejection = { cause: { code: "23505" } };
    const result = await createPendingBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      requestedBy: "adv-1",
    });
    expect(result).toEqual({ ok: false, reason: "already_live" });
  });

  it("rethrows a non-unique-violation insert error", async () => {
    queue = [[], []];
    insertRejection = new Error("connection reset");
    await expect(
      createPendingBinding({ clientId: "c1", clerkUserId: "user_x", requestedBy: "adv-1" }),
    ).rejects.toThrow("connection reset");
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

  // Finding 4: DESC sorts NULLs FIRST in Postgres, so a declined row with a
  // (theoretically anomalous) null endedAt must be excluded from the
  // cooldown lookup entirely, not merely out-ranked.
  it("filters out a null endedAt from the cooldown lookup (NULLS FIRST would otherwise bypass it)", async () => {
    queue = [[], [], [{ id: "new-binding" }]];
    await createPendingBinding({ clientId: "c1", clerkUserId: "user_x", requestedBy: "adv-1" });
    const compiled = compile(selectWhereArgs[1]);
    expect(compiled.sql).toContain("is not null");
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

describe("deletePendingBinding", () => {
  it("removes the row in ONE conditional statement — no read first, and nothing to audit", async () => {
    queue = [[{ id: "b1" }]];
    const result = await deletePendingBinding("b1", "c1");
    expect(result).toBe(true);
    // A read-then-delete would let a racing accept slip between the two.
    expect(selectFrom).not.toHaveBeenCalled();
    // Nobody was ever told the request existed — the send is what audits.
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("returns false when the DELETE matches nothing (a racing accept already moved the row)", async () => {
    queue = [[]];
    expect(await deletePendingBinding("b1", "c1")).toBe(false);
  });

  it("can only ever remove a PENDING row — id AND status are bound parameters of the WHERE", async () => {
    queue = [[{ id: "b1" }]];
    await deletePendingBinding("b1", "c1");
    const compiled = compile(deleteWhereArgs[0]);
    expect(compiled.params).toContain("b1");
    // Without this, a failed send could delete a live or historical binding.
    expect(compiled.params).toContain("pending");
    expect(compiled.sql).toContain("status");
  });

  // Every other mutator here is scoped to the row's owner — `revokeBinding` by
  // (clientId, clerkUserId), accept/decline by (bindingId, clerkUserId). A bare
  // id would make this the one place a stray uuid reaches another household's
  // pending row, and the caller has the clientId in hand.
  it("is scoped to the household too — a bare bindingId cannot reach another client's row", async () => {
    queue = [[{ id: "b1" }]];
    await deletePendingBinding("b1", "c1");
    const compiled = compile(deleteWhereArgs[0]);
    expect(compiled.params).toContain("c1");
    expect(compiled.sql).toContain("client_id");
  });
});

describe("acceptBinding", () => {
  it("promotes a pending row to active and audits it", async () => {
    const future = new Date(Date.now() + 1000);
    queue = [[{ clientId: "c1", status: "pending", expiresAt: future, firmId: "firm-1" }], [{ id: "b1" }]];
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

  it("refuses (not_found) when the initial read finds no row", async () => {
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

  // Finding 2 (the race): the read approves, but the atomic UPDATE's own
  // WHERE re-check finds the row already moved off `pending` (e.g. a
  // concurrent decline in another tab won). The UPDATE, not the read, is
  // authoritative — zero rows back means nothing was written and nothing
  // is audited, even though the read looked fine.
  it("refuses (not_pending) when the atomic UPDATE's own re-check finds zero rows — the accept/decline race", async () => {
    const future = new Date(Date.now() + 1000);
    queue = [[{ clientId: "c1", status: "pending", expiresAt: future, firmId: "firm-1" }], []];
    const result = await acceptBinding("b1", "user_x");
    expect(result).toEqual({ ok: false, reason: "not_pending" });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("declineBinding", () => {
  it("declines a pending row and audits it", async () => {
    queue = [[{ clientId: "c1", status: "pending", firmId: "firm-1" }], [{ id: "b1" }]];
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

  it("refuses (false) when the atomic UPDATE's own re-check finds zero rows — the accept/decline race", async () => {
    queue = [[{ clientId: "c1", status: "pending", firmId: "firm-1" }], []];
    const result = await declineBinding("b1", "user_x");
    expect(result).toBe(false);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("revokeBinding", () => {
  it("writes endedBy exactly as passed — 'client'", async () => {
    queue = [[{ id: "b1", firmId: "firm-1" }], [{ id: "b1" }]];
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
    queue = [[{ id: "b2", firmId: "firm-1" }], [{ id: "b2" }]];
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

  it("returns false (not true) when the atomic UPDATE's own re-check finds zero rows, even though the read found a row", async () => {
    queue = [[{ id: "b1", firmId: "firm-1" }], []];
    const result = await revokeBinding({
      clientId: "c1",
      clerkUserId: "user_x",
      endedBy: "client",
      actorId: "user_x",
    });
    expect(result).toBe(false);
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

  it("orders NULLS LAST so an unaccepted row can never look most-recent", async () => {
    queue = [[]];
    await getActiveBindingClerkUserId("c1");
    const compiled = compile(selectOrderByArgs[0]);
    expect(compiled.sql).toContain("NULLS LAST");
  });
});

/**
 * FINDING 1 (critical): the ownership predicate itself, proven by compiling
 * the REAL condition objects `acceptBinding` / `declineBinding` /
 * `revokeBinding` pass to `.where()` with a real `PgDialect` — no live DB
 * needed, since drizzle-orm and @/db/schema are not mocked in this file,
 * only @/db. This is deliberately NOT an "empty result set ⇒ not_found"
 * behavioral test (that only proves the function handles an empty row set,
 * which is the mock answering its own question) — it asserts the caller's
 * clerkUserId is a literal bound parameter of the compiled WHERE clause on
 * BOTH the read and the atomically-re-checked write.
 *
 * Verified by deliberately deleting `eq(portalBindings.clerkUserId,
 * clerkUserId)` from each function's UPDATE `.where(...)` and re-running
 * this file — see the fix report for the exact failing assertion and
 * message, then the predicate was restored and this suite re-run green.
 */
describe("authorization: the clerkUserId predicate is a real bound parameter", () => {
  it("acceptBinding: clerkUserId is bound in both the read's and the UPDATE's WHERE", async () => {
    const future = new Date(Date.now() + 1000);
    queue = [[{ clientId: "c1", status: "pending", expiresAt: future, firmId: "firm-1" }], [{ id: "b1" }]];
    await acceptBinding("b1", "user_x");

    const readParams = compile(selectWhereArgs[0]).params;
    expect(readParams).toContain("user_x");

    const writeCompiled = compile(updateWhereArgs[0]);
    expect(writeCompiled.params).toContain("user_x");
    expect(writeCompiled.sql).toContain("clerk_user_id");
    // the status re-check that closes the accept/decline race
    expect(writeCompiled.params).toContain("pending");
  });

  it("declineBinding: clerkUserId is bound in both the read's and the UPDATE's WHERE", async () => {
    queue = [[{ clientId: "c1", status: "pending", firmId: "firm-1" }], [{ id: "b1" }]];
    await declineBinding("b1", "user_x");

    const readParams = compile(selectWhereArgs[0]).params;
    expect(readParams).toContain("user_x");

    const writeCompiled = compile(updateWhereArgs[0]);
    expect(writeCompiled.params).toContain("user_x");
    expect(writeCompiled.sql).toContain("clerk_user_id");
  });

  it("revokeBinding: clerkUserId is bound in both the read's and the UPDATE's WHERE", async () => {
    queue = [[{ id: "b1", firmId: "firm-1" }], [{ id: "b1" }]];
    await revokeBinding({ clientId: "c1", clerkUserId: "user_x", endedBy: "client", actorId: "user_x" });

    const readParams = compile(selectWhereArgs[0]).params;
    expect(readParams).toContain("user_x");

    const writeCompiled = compile(updateWhereArgs[0]);
    expect(writeCompiled.params).toContain("user_x");
    expect(writeCompiled.sql).toContain("clerk_user_id");
  });
});

describe("revokeAllForUser", () => {
  it("ends every ACTIVE binding the login holds and reports how many", async () => {
    queue = [[{ id: "b1" }, { id: "b2" }]];
    const ended = await revokeAllForUser("user_x");
    expect(ended).toBe(2);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "revoked", endedBy: "advisor" }),
    );
  });

  it("returns 0 when the login holds nothing active", async () => {
    queue = [[]];
    expect(await revokeAllForUser("user_x")).toBe(0);
  });

  it("skips the write entirely for an empty clerkUserId", async () => {
    const ended = await revokeAllForUser("");
    expect(ended).toBe(0);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("scopes the UPDATE to that login's ACTIVE rows — never a whole table sweep", async () => {
    queue = [[{ id: "b1" }]];
    await revokeAllForUser("user_x");
    const compiled = compile(updateWhereArgs[0]);
    expect(compiled.sql).toContain("clerk_user_id");
    expect(compiled.params).toContain("user_x");
    expect(compiled.params).toContain("active");
  });

  it("stamps endedAt so the row records when access ended", async () => {
    queue = [[{ id: "b1" }]];
    await revokeAllForUser("user_x");
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ endedAt: expect.any(Date) }),
    );
  });
});

describe("getPendingRequestForClient", () => {
  it("skips the query and returns null for an empty clientId", async () => {
    expect(await getPendingRequestForClient("")).toBeNull();
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it("returns the request's requestedAt so the advisor can be told when it went out", async () => {
    const sent = new Date("2026-09-01T00:00:00Z");
    queue = [[{ requestedAt: sent }]];
    expect(await getPendingRequestForClient("c1")).toEqual({ requestedAt: sent });
  });

  it("returns null when nothing is awaiting the client's answer", async () => {
    queue = [[]];
    expect(await getPendingRequestForClient("c1")).toBeNull();
  });

  it("asks only for PENDING rows of this household", async () => {
    queue = [[]];
    await getPendingRequestForClient("c1");
    const compiled = compile(selectWhereArgs[0]);
    expect(compiled.params).toContain("c1");
    expect(compiled.params).toContain("pending");
  });

  it("ignores an expired request — an expired row can never be accepted", async () => {
    queue = [[]];
    await getPendingRequestForClient("c1");
    const compiled = compile(selectWhereArgs[0]);
    // Same shape as listPendingRequests: a null expiry never expires, so it
    // matches too rather than being dropped.
    expect(compiled.sql).toContain("expires_at");
    expect(compiled.sql).toContain("is null");
  });
});

describe("getClientDisconnectedAt", () => {
  it("skips the query and returns null for an empty clientId", async () => {
    expect(await getClientDisconnectedAt("")).toBeNull();
    expect(selectFrom).not.toHaveBeenCalled();
  });

  it("returns when the CLIENT last disconnected themselves", async () => {
    const left = new Date("2026-08-20T00:00:00Z");
    queue = [[{ endedAt: left }]];
    expect(await getClientDisconnectedAt("c1")).toEqual(left);
  });

  it("returns null when no one has disconnected", async () => {
    queue = [[]];
    expect(await getClientDisconnectedAt("c1")).toBeNull();
  });

  it("asks only for rows the CLIENT ended — an advisor's own revoke is not a disconnect", async () => {
    queue = [[]];
    await getClientDisconnectedAt("c1");
    const compiled = compile(selectWhereArgs[0]);
    expect(compiled.sql).toContain("ended_by");
    expect(compiled.params).toContain("client");
    expect(compiled.params).toContain("revoked");
    expect(compiled.params).not.toContain("advisor");
  });

  it("orders NULLS LAST so a row with no endedAt cannot look most-recent", async () => {
    queue = [[]];
    await getClientDisconnectedAt("c1");
    expect(compile(selectOrderByArgs[0]).sql).toContain("NULLS LAST");
  });
});
