// src/lib/db-tx.ts
/**
 * Write options a core takes so it can join a caller's transaction — the fact
 * finder save writes every line in one. Called without them a core behaves as
 * it always has: its statements on module `db`, its own transaction, any
 * after-commit work run at once. Called with `tx`, every statement runs on it
 * (a read on module `db` uses another pooled connection, which can't see a row
 * the transaction wrote and isn't rolled back with it), and work that must
 * follow the commit goes to `afterCommit`.
 */
import { db } from "@/db";
import type { Principal } from "@/lib/clients/authz";
import { safeErrorFields } from "@/lib/redaction/secrets";

/** A Drizzle transaction handle. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** What a read or write runs on: module `db`, or a transaction. */
export type DbOrTx = typeof db | Tx;
/** Work to run once the caller's transaction has committed. */
export type AfterCommit = (work: () => Promise<void>) => void;

/**
 * With a caller's `tx` a core's refusal is not atomic: an `{ ok: false }` may
 * leave the writes before it on `tx`, or `tx` aborted — the caller must roll
 * back on any `{ ok: false }` (the fact finder save throws).
 */
export interface WriteOptions {
  tx?: Tx;
  afterCommit?: AfterCommit;
  /** Whose access the core checks when the call has no Clerk session (the Claude connector's); without it, the session's. */
  principal?: Principal;
}

/** The caller's transaction, else module `db`. */
export function handleOf(opts: WriteOptions): DbOrTx {
  return opts.tx ?? db;
}

/**
 * `fn` on the caller's transaction, else in a transaction of its own — createClientForHousehold's shape.
 * On the caller's there is no savepoint: what `fn` wrote before a refusal stays until the caller rolls back.
 */
export function inTransaction<T>(opts: WriteOptions, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return opts.tx ? fn(opts.tx) : db.transaction(fn);
}

/** Queues `work` for after the caller's commit, or runs it now when the caller has no transaction. */
export async function runAfterCommit(opts: WriteOptions, work: () => Promise<void>): Promise<void> {
  if (opts.afterCommit) {
    opts.afterCommit(work);
    return;
  }
  // Run now inside the caller's transaction, it would run before the commit it must follow.
  if (opts.tx) throw new Error("runAfterCommit: a caller's transaction needs an afterCommit queue");
  await work();
}

/** The save's queue: hand `afterCommit` to every write, then `flush()` once committed — a failing item is logged, the rest still run. */
export function afterCommitQueue(): { afterCommit: AfterCommit; flush(): Promise<void>; size(): number } {
  const queue: (() => Promise<void>)[] = [];
  return {
    afterCommit: (work) => {
      queue.push(work);
    },
    async flush() {
      for (const work of queue.splice(0)) {
        try {
          await work();
        } catch (err) {
          console.error("[save] after-commit work failed:", safeErrorFields(err));
        }
      }
    },
    size: () => queue.length,
  };
}
