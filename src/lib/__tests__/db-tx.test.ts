// src/lib/__tests__/db-tx.test.ts
//
// The write options a core takes so it can join a caller's transaction: where
// its statements run, when it opens a transaction of its own, and when work
// that must follow the commit runs.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const ownTx = { name: "the core's own transaction" };
  return { ownTx, transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(ownTx)) };
});
vi.mock("@/db", () => ({ db: { transaction: h.transaction } }));

import { db } from "@/db";
import { afterCommitQueue, handleOf, inTransaction, runAfterCommit, type Tx } from "../db-tx";

const callerTx = { name: "the caller's transaction" } as unknown as Tx;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleOf", () => {
  it("is the caller's transaction, else module db", () => {
    expect(handleOf({ tx: callerTx })).toBe(callerTx);
    expect(handleOf({})).toBe(db);
  });
});

describe("inTransaction", () => {
  it("runs on the caller's transaction without opening another", async () => {
    await expect(inTransaction({ tx: callerTx }, async (tx) => tx)).resolves.toBe(callerTx);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("opens a transaction of its own on db when the caller has none", async () => {
    await expect(inTransaction({}, async (tx) => tx)).resolves.toBe(h.ownTx);
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("runAfterCommit", () => {
  it("queues the work when the caller collects it", async () => {
    const queued: (() => Promise<void>)[] = [];
    const work = vi.fn(async () => {});
    await runAfterCommit({ tx: callerTx, afterCommit: (w) => queued.push(w) }, work);
    expect(work).not.toHaveBeenCalled();
    expect(queued).toEqual([work]);
  });

  it("runs it now when nobody collects it", async () => {
    const work = vi.fn(async () => {});
    await runAfterCommit({}, work);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("refuses to run it inside a caller's transaction that has no queue", async () => {
    const work = vi.fn(async () => {});
    await expect(runAfterCommit({ tx: callerTx }, work)).rejects.toThrow("needs an afterCommit queue");
    expect(work).not.toHaveBeenCalled();
  });
});

describe("afterCommitQueue", () => {
  it("holds the work until flush, then runs each item once, in order", async () => {
    const queue = afterCommitQueue();
    const ran: string[] = [];
    queue.afterCommit(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      ran.push("first");
    });
    queue.afterCommit(async () => {
      ran.push("second");
    });
    expect(queue.size()).toBe(2);
    expect(ran).toEqual([]);

    await queue.flush();
    expect(ran).toEqual(["first", "second"]);
    expect(queue.size()).toBe(0);

    await queue.flush();
    expect(ran).toEqual(["first", "second"]);
  });

  it("logs a failing item and still runs the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = afterCommitQueue();
    const ran: string[] = [];
    queue.afterCommit(async () => {
      throw new Error("sync failed");
    });
    queue.afterCommit(async () => {
      ran.push("after the failure");
    });

    await queue.flush();
    expect(ran).toEqual(["after the failure"]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[save] after-commit work failed:", expect.objectContaining({ message: "sync failed" }));
    // Only the error's safe fields: a raw driver error can carry the database URL.
    expect(error.mock.calls[0][1]).not.toBeInstanceOf(Error);
    error.mockRestore();
  });
});
