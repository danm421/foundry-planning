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
const insertMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
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
