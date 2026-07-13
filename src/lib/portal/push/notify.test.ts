import { describe, it, expect, beforeEach, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("./expo-client", () => ({ sendExpoPush: sendMock }));
vi.mock("@/db/schema", () => ({
  portalNotifications: { _n: "pn", clientId: "c", kind: "k", plaidItemId: "p", createdAt: "ca", id: "id" },
  portalPushTokens: { _n: "ppt", clientId: "c", enabled: "e", expoPushToken: "t" },
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
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereArgs.push(cond);
          const rows = selectQueue.shift() ?? [];
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({ values: (v: unknown) => { insertMock(v); return Promise.resolve(); } }),
    delete: () => ({ where: (w: unknown) => { deleteMock(w); return Promise.resolve(); } }),
  },
}));

import { notifyTransactionsToReview, notifyReconnectRequired } from "./notify";

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
    selectQueue.push([{ token: "ExponentPushToken[a]" }]); // one enabled token
    selectQueue.push([{ count: 5 }]);                  // to-review count
    await notifyTransactionsToReview("client-1");
    expect(sendMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "transactions_to_review", tokenCount: 1, plaidItemId: null }),
    );
  });

  it("does not send when the to-review count is zero", async () => {
    selectQueue.push([]);
    selectQueue.push([{ token: "ExponentPushToken[a]" }]);
    selectQueue.push([{ count: 0 }]);
    await notifyTransactionsToReview("client-1");
    expect(sendMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("prunes tokens the send reports invalid", async () => {
    selectQueue.push([]);
    selectQueue.push([{ token: "ExponentPushToken[a]" }]);
    selectQueue.push([{ count: 2 }]);
    sendMock.mockResolvedValue({ sentCount: 1, invalidTokens: ["ExponentPushToken[a]"] });
    await notifyTransactionsToReview("client-1");
    expect(deleteMock).toHaveBeenCalledOnce();
  });
});

describe("notifyReconnectRequired", () => {
  it("sends a reconnect push logged against the item", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([{ token: "ExponentPushToken[a]" }]); // tokens
    await notifyReconnectRequired({ id: "item-1", clientId: "client-1", institutionName: "Chase" });
    expect(sendMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reconnect_required", plaidItemId: "item-1", tokenCount: 1 }),
    );
  });
});

// ── Predicate-level throttle assertions ──────────────────────────────────────
// The mocks above discard nothing now: `where(cond)` records `cond` into
// `whereArgs` in call order. The drizzle operator stubs echo their args
// (`and`/`eq`/`gt`/`isNull` → arrays) and the table mocks map columns to
// sentinel strings, so a captured `and(...)` cond is a nested array of
// `[sentinel, value]` pairs. Query order is: [0] throttle, [1] tokens,
// [2] to-review count (transactions path only).
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
    selectQueue.push([{ token: "ExponentPushToken[a]" }]); // tokens
    await notifyReconnectRequired({ id: "item-1", clientId: "client-1", institutionName: "Chase" });
    // whereArgs[0] is the throttle query's `and(...)` conds.
    expect(whereArgs[0]).toContainEqual(["c", "client-1"]);
    // Dropping the plaidItemId cond (per-item keying) would fail this:
    expect(whereArgs[0]).toContainEqual(["p", "item-1"]);
    expect(hasCond(whereArgs[0], "p")).toBe(true);
  });

  it("transactions throttle query is NOT keyed by item", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([{ token: "ExponentPushToken[a]" }]); // tokens
    selectQueue.push([{ count: 5 }]);                  // to-review count
    await notifyTransactionsToReview("client-1");
    expect(whereArgs[0]).toContainEqual(["c", "client-1"]);
    // No plaidItemId cond may leak into the transactions throttle grain:
    expect(hasCond(whereArgs[0], "p")).toBe(false);
  });

  it("transactions throttle window is recent and ≈ 4h wide", async () => {
    selectQueue.push([]);
    selectQueue.push([{ token: "ExponentPushToken[a]" }]);
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
    selectQueue.push([{ token: "ExponentPushToken[a]" }]);
    await notifyReconnectRequired({ id: "item-1", clientId: "client-1", institutionName: "Chase" });
    const since = condValue(whereArgs[0], "ca");
    expect(since).toBeInstanceOf(Date);
    const sinceMs = (since as Date).getTime();
    expect(sinceMs).toBeLessThan(Date.now());
    expect(Math.abs(Date.now() - sinceMs - 24 * 60 * 60 * 1000)).toBeLessThan(5000);
  });

  it("to-review count query filters on reviewedAt IS NULL", async () => {
    selectQueue.push([]);                              // throttle clear
    selectQueue.push([{ token: "ExponentPushToken[a]" }]); // tokens
    selectQueue.push([{ count: 3 }]);                  // to-review count
    await notifyTransactionsToReview("client-1");
    // whereArgs[2] is the count query's `and(...)` conds.
    expect(whereArgs[2]).toContainEqual(["c", "client-1"]);
    // `isNull(plaidTransactions.reviewedAt)` → `["r"]`; dropping it would fail:
    expect(whereArgs[2]).toContainEqual(["r"]);
    expect(hasCond(whereArgs[2], "r")).toBe(true);
  });
});
