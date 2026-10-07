import { describe, it, expect, beforeEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("./expo-client", () => ({ sendExpoPush: sendMock }));
vi.mock("@/db/schema", () => ({
  portalNotifications: { _n: "pn", clientId: "c", kind: "k", plaidItemId: "p", createdAt: "ca", id: "id" },
  portalPushTokens: { _n: "ppt", clientId: "c", enabled: "e", expoPushToken: "t", clerkUserId: "u" },
  portalBindings: { _n: "pb", clientId: "bc", clerkUserId: "bu", status: "bs" },
  clients: { _n: "cl", id: "cid", clerkUserId: "ccu" },
  plaidTransactions: { _n: "ptx", clientId: "c", reviewedAt: "r" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  gt: (...a: unknown[]) => a,
  isNull: (...a: unknown[]) => a,
  inArray: (...a: unknown[]) => a,
  sql: (s: unknown) => s,
}));

const selectQueue: unknown[][] = [];
// Records every `.where(cond)` arg passed to a SELECT query, in call order.
// The drizzle operator stubs return their args, so each captured cond is a
// nested array of `[sentinel, value]` pairs assertable against the mock.
const whereArgs: unknown[] = [];
const insertMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/db", () => {
  const where = (cond: unknown) => {
    whereArgs.push(cond);
    const rows = selectQueue.shift() ?? [];
    return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
  };
  return {
    db: {
      select: () => ({
        from: () => ({ where, innerJoin: () => ({ where }) }),
      }),
      insert: () => ({ values: (v: unknown) => { insertMock(v); return Promise.resolve(); } }),
      delete: () => ({ where: (w: unknown) => { deleteMock(w); return Promise.resolve(); } }),
    },
  };
});

import { notifyTransactionsToReview, notifyReconnectRequired } from "./notify";

// One enabled token on household client-1, and the binding that makes its login live.
const TOKEN_A = { token: "ExponentPushToken[a]", clerkUserId: "user_a", legacyClerkUserId: null };
const LIVE_A = [{ clientId: "client-1", clerkUserId: "user_a", status: "active" }];

beforeEach(() => {
  selectQueue.length = 0;
  whereArgs.length = 0;
  sendMock.mockReset().mockResolvedValue({ sentCount: 1, invalidTokens: [] });
  insertMock.mockReset();
  deleteMock.mockReset();
});

describe("notifyTransactionsToReview", () => {
  it("no-ops (no send, no log) when a recent notification exists", async () => {
    selectQueue.push([{ id: "recent" }]); // throttle query hits
    await notifyTransactionsToReview("client-1");
    expect(sendMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("no-ops when the client has no enabled tokens", async () => {
    selectQueue.push([]);        // throttle: clear
    selectQueue.push([]);        // tokens: none
    await notifyTransactionsToReview("client-1");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends and logs with the current to-review count", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([TOKEN_A]);                       // one enabled token
    selectQueue.push(LIVE_A);                          // its login's bindings
    selectQueue.push([{ count: 5 }]);                  // to-review count
    await notifyTransactionsToReview("client-1");
    expect(sendMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "transactions_to_review", tokenCount: 1, plaidItemId: null }),
    );
  });

  it("does not send when the to-review count is zero", async () => {
    selectQueue.push([]);
    selectQueue.push([TOKEN_A]);
    selectQueue.push(LIVE_A);
    selectQueue.push([{ count: 0 }]);
    await notifyTransactionsToReview("client-1");
    expect(sendMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("prunes tokens the send reports invalid", async () => {
    selectQueue.push([]);
    selectQueue.push([TOKEN_A]);
    selectQueue.push(LIVE_A);
    selectQueue.push([{ count: 2 }]);
    sendMock.mockResolvedValue({ sentCount: 1, invalidTokens: ["ExponentPushToken[a]"] });
    await notifyTransactionsToReview("client-1");
    expect(deleteMock).toHaveBeenCalledOnce();
  });
});

describe("notifyReconnectRequired", () => {
  it("sends a reconnect push logged against the item", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([TOKEN_A]);                       // tokens
    selectQueue.push(LIVE_A);                          // bindings
    await notifyReconnectRequired({ id: "item-1", clientId: "client-1", institutionName: "Chase" });
    expect(sendMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reconnect_required", plaidItemId: "item-1", tokenCount: 1 }),
    );
  });
});

describe("who a push reaches", () => {
  const notify = () =>
    notifyReconnectRequired({ id: "item-1", clientId: "client-1", institutionName: "Chase" });

  it("sends nothing to a login whose access to the household has ended", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([TOKEN_A]);                       // the token is still registered
    selectQueue.push([{ clientId: "client-1", clerkUserId: "user_a", status: "revoked" }]);
    await notify();
    expect(sendMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("sends only to the logins still connected when the household has several", async () => {
    selectQueue.push([]);
    selectQueue.push([TOKEN_A, { token: "ExponentPushToken[b]", clerkUserId: "user_b", legacyClerkUserId: null }]);
    selectQueue.push([
      { clientId: "client-1", clerkUserId: "user_a", status: "revoked" },
      { clientId: "client-1", clerkUserId: "user_b", status: "active" },
    ]);
    await notify();
    expect(sendMock).toHaveBeenCalledWith(["ExponentPushToken[b]"], expect.anything());
  });

  it("does not count a login's connection to a different household", async () => {
    selectQueue.push([]);
    selectQueue.push([TOKEN_A]);
    selectQueue.push([{ clientId: "client-2", clerkUserId: "user_a", status: "active" }]);
    await notify();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still reaches a login connected only through the household's original portal column", async () => {
    selectQueue.push([]);
    selectQueue.push([{ ...TOKEN_A, legacyClerkUserId: "user_a" }]);
    // A pending request from another firm settles nothing, so the column still answers.
    selectQueue.push([{ clientId: "client-2", clerkUserId: "user_a", status: "pending" }]);
    await notify();
    expect(sendMock).toHaveBeenCalledWith(["ExponentPushToken[a]"], expect.anything());
  });

  it("ignores that column once the login's access has been removed", async () => {
    selectQueue.push([]);
    selectQueue.push([{ ...TOKEN_A, legacyClerkUserId: "user_a" }]);
    selectQueue.push([{ clientId: "client-1", clerkUserId: "user_a", status: "revoked" }]);
    await notify();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

// ── Predicate-level throttle assertions ──────────────────────────────────────
// The mocks above discard nothing now: `where(cond)` records `cond` into
// `whereArgs` in call order. The drizzle operator stubs echo their args
// (`and`/`eq`/`gt`/`isNull` → arrays) and the table mocks map columns to
// sentinel strings, so a captured `and(...)` cond is a nested array of
// `[sentinel, value]` pairs. Query order is: [0] throttle, [1] tokens,
// [2] the token logins' bindings, [3] to-review count (transactions path only).
//
// Sentinels in play (from the @/db/schema mock above):
//   portalNotifications.clientId → "c", .kind → "k", .createdAt → "ca",
//   .plaidItemId → "p"; plaidTransactions.reviewedAt → "r".

/** True when `conds` (a captured `and(...)` array) holds a `[sentinel, ...]` pair. */
function hasCond(conds: unknown, sentinel: string): boolean {
  return (
    Array.isArray(conds) &&
    conds.some((c) => Array.isArray(c) && c[0] === sentinel)
  );
}

/** Extract the value of the first `[sentinel, value]` pair inside a captured `and(...)`. */
function condValue(conds: unknown, sentinel: string): unknown {
  if (!Array.isArray(conds)) return undefined;
  const pair = conds.find((c) => Array.isArray(c) && c[0] === sentinel) as
    | unknown[]
    | undefined;
  return pair?.[1];
}

describe("throttle predicate shape", () => {
  it("reconnect throttle query is keyed per client AND item", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([TOKEN_A]);                       // tokens
    selectQueue.push(LIVE_A);                          // bindings
    await notifyReconnectRequired({ id: "item-1", clientId: "client-1", institutionName: "Chase" });
    // whereArgs[0] is the throttle query's `and(...)` conds.
    expect(whereArgs[0]).toContainEqual(["c", "client-1"]);
    // Dropping the plaidItemId cond (per-item keying) would fail this:
    expect(whereArgs[0]).toContainEqual(["p", "item-1"]);
    expect(hasCond(whereArgs[0], "p")).toBe(true);
  });

  it("transactions throttle query is NOT keyed by item", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([TOKEN_A]);                       // tokens
    selectQueue.push(LIVE_A);                          // bindings
    selectQueue.push([{ count: 5 }]);                  // to-review count
    await notifyTransactionsToReview("client-1");
    expect(whereArgs[0]).toContainEqual(["c", "client-1"]);
    // No plaidItemId cond may leak into the transactions throttle grain:
    expect(hasCond(whereArgs[0], "p")).toBe(false);
  });

  it("transactions throttle window is recent and ≈ 4h wide", async () => {
    selectQueue.push([]);
    selectQueue.push([TOKEN_A]);
    selectQueue.push(LIVE_A);
    selectQueue.push([{ count: 5 }]);
    await notifyTransactionsToReview("client-1");
    const since = condValue(whereArgs[0], "ca");
    expect(since).toBeInstanceOf(Date);
    const sinceMs = (since as Date).getTime();
    // In the PAST — guards a `+windowMs` sign flip:
    expect(sinceMs).toBeLessThan(Date.now());
    // ≈ 4h back from now (tolerance covers test execution time):
    expect(Math.abs(Date.now() - sinceMs - 4 * 60 * 60 * 1000)).toBeLessThan(5000);
  });

  it("reconnect throttle window is recent and ≈ 24h wide", async () => {
    selectQueue.push([]);
    selectQueue.push([TOKEN_A]);
    selectQueue.push(LIVE_A);
    await notifyReconnectRequired({ id: "item-1", clientId: "client-1", institutionName: "Chase" });
    const since = condValue(whereArgs[0], "ca");
    expect(since).toBeInstanceOf(Date);
    const sinceMs = (since as Date).getTime();
    expect(sinceMs).toBeLessThan(Date.now());
    expect(Math.abs(Date.now() - sinceMs - 24 * 60 * 60 * 1000)).toBeLessThan(5000);
  });

  it("to-review count query filters on reviewedAt IS NULL", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([TOKEN_A]);                       // tokens
    selectQueue.push(LIVE_A);                          // bindings
    selectQueue.push([{ count: 3 }]);                  // to-review count
    await notifyTransactionsToReview("client-1");
    // whereArgs[3] is the count query's `and(...)` conds.
    expect(whereArgs[3]).toContainEqual(["c", "client-1"]);
    // `isNull(plaidTransactions.reviewedAt)` → `["r"]`; dropping it would fail:
    expect(whereArgs[3]).toContainEqual(["r"]);
    expect(hasCond(whereArgs[3], "r")).toBe(true);
  });
});
