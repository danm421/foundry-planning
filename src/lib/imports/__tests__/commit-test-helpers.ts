/**
 * Lightweight Drizzle-shaped transaction fake used by the commit-module
 * unit tests. Records every chain-end call so tests can assert which
 * tables saw which writes.
 *
 * Supports the chains the commit modules actually use:
 *   tx.insert(table).values(rows) [.returning(...)]
 *   tx.update(table).set(values).where(...) [.returning(...)]
 *   tx.select(cols).from(table).where(...)
 *   tx.delete(table).where(...)
 *
 * Behaviors per chain endpoint:
 *   - insert.values() resolves void.
 *   - insert.values().returning() resolves to one mock row per inserted
 *     payload, with `id` keys filled from the table's name.
 *   - update.set.where() resolves to undefined.
 *   - update.set.where.returning() resolves to a mock row carrying any
 *     fields registered via `setSelectResult`.
 *   - select.from.where() returns whatever was registered via
 *     `setSelectResult(tableName, rows)`, or [] by default.
 *   - delete.where() resolves to undefined.
 *
 * All recorded calls live on `calls`. Each entry has `op`, `table`, and
 * `values` (insert/update only).
 */
import { getTableName, is, Table } from "drizzle-orm";
import { vi } from "vitest";

import type { Tx } from "@/lib/imports/commit/types";

interface InsertCall {
  op: "insert";
  table: string;
  values: unknown;
}

interface UpdateCall {
  op: "update";
  table: string;
  values: unknown;
}

interface DeleteCall {
  op: "delete";
  table: string;
}

interface SelectCall {
  op: "select";
  table: string;
}

export type FakeTxCall = InsertCall | UpdateCall | DeleteCall | SelectCall;

function tableName(t: unknown): string {
  if (is(t as Table, Table)) {
    return getTableName(t as Table);
  }
  return "<unknown>";
}

export interface FakeTx {
  tx: Tx;
  calls: FakeTxCall[];
  /** Register what `select(...).from(table).where(...)` should return. */
  setSelectResult(table: string, rows: unknown[]): void;
  /** Override the row id assigned to inserts into a specific table. */
  setInsertId(table: string, id: string): void;
  /** Provide an array of returned ids for sequential inserts into a table. */
  queueInsertIds(table: string, ids: string[]): void;
}

export function makeFakeTx(): FakeTx {
  const calls: FakeTxCall[] = [];
  const selectResults = new Map<string, unknown[]>();
  const insertIdMap = new Map<string, string>();
  const insertIdQueue = new Map<string, string[]>();
  let nextAutoId = 0;

  const nextId = (table: string): string => {
    const queue = insertIdQueue.get(table);
    if (queue && queue.length > 0) return queue.shift()!;
    if (insertIdMap.has(table)) return insertIdMap.get(table)!;
    nextAutoId += 1;
    return `${table}-id-${nextAutoId}`;
  };

  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const tName = tableName(table);
        calls.push({ op: "insert", table: tName, values });
        const valArr = Array.isArray(values) ? values : [values];
        const rows = valArr.map(() => ({ id: nextId(tName) }));
        const promise = Promise.resolve();
        // returning() intercepts the chain: the consumer awaits the
        // returning() promise (rows), not the .values() promise.
        return Object.assign(promise, {
          returning: vi.fn(() => Promise.resolve(rows)),
        });
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          const tName = tableName(table);
          calls.push({ op: "update", table: tName, values });
          const promise = Promise.resolve();
          return Object.assign(promise, {
            returning: vi.fn(() =>
              Promise.resolve([{ id: nextId(tName) }]),
            ),
          });
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const tName = tableName(table);
          calls.push({ op: "select", table: tName });
          return Promise.resolve(selectResults.get(tName) ?? []);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        const tName = tableName(table);
        calls.push({ op: "delete", table: tName });
        return Promise.resolve();
      },
    }),
  };

  return {
    tx: tx as unknown as Tx,
    calls,
    setSelectResult(table, rows) {
      selectResults.set(table, rows);
    },
    setInsertId(table, id) {
      insertIdMap.set(table, id);
    },
    queueInsertIds(table, ids) {
      insertIdQueue.set(table, [...ids]);
    },
  };
}

export function callsForTable(calls: FakeTxCall[], table: string): FakeTxCall[] {
  return calls.filter((c) => c.table === table);
}
