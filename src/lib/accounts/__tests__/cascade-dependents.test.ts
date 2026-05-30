import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for `listAccountCascadeDependents` (audit F15).
 *
 * transfers.source/target_account_id and roth_conversions.destination_account_id
 * are ON DELETE CASCADE, so deleting an account silently deletes that multi-year
 * transfer / conversion intent. This helper powers the pre-delete warning that
 * lists what would be lost. It must be clientId-scoped so it can never surface
 * (or imply deletion of) another client's rows.
 *
 * Same in-memory-DB technique as db-scoping.test.ts: swap eq/and/or for
 * inspectable predicates and evaluate them over seeded rows, so dropping the
 * clientId filter makes a cross-client row leak and fails a test.
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Col = { name: string };
  type Pred =
    | { k: "eq"; name: string; val: unknown }
    | { k: "and"; conds: Pred[] }
    | { k: "or"; conds: Pred[] };
  const tables: Record<string, Row[]> = {};
  function evalPred(pred: Pred, row: Row): boolean {
    if (pred.k === "eq") return row[pred.name] === pred.val;
    if (pred.k === "and") return pred.conds.every((c) => evalPred(c, row));
    return pred.conds.some((c) => evalPred(c, row));
  }
  return {
    tables,
    evalPred,
    eq: (col: Col, val: unknown): Pred => ({ k: "eq", name: col.name, val }),
    and: (...conds: Pred[]): Pred => ({ k: "and", conds }),
    or: (...conds: Pred[]): Pred => ({ k: "or", conds }),
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: h.eq, and: h.and, or: h.or };
});

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Proj = Record<string, { name: string }>;
  const db = {
    select(proj: Proj) {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const tableName = getTableName(table);
          return {
            where(pred: Parameters<typeof h.evalPred>[0]) {
              const rows = (h.tables[tableName] ?? []).filter((r) => h.evalPred(pred, r));
              return Promise.resolve(
                rows.map((r) => {
                  const out: Record<string, unknown> = {};
                  for (const key of Object.keys(proj)) out[key] = r[proj[key].name];
                  return out;
                }),
              );
            },
          };
        },
      };
    },
  };
  return { db };
});

import { getTableName } from "drizzle-orm";
import { transfers, rothConversions } from "@/db/schema";
import { listAccountCascadeDependents } from "@/lib/accounts/cascade-dependents";

function setTable(table: Parameters<typeof getTableName>[0], rows: Record<string, unknown>[]) {
  h.tables[getTableName(table)] = rows;
}

const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OTHER_CLIENT = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ACCT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
});

describe("listAccountCascadeDependents", () => {
  it("returns empty arrays when nothing references the account", async () => {
    const res = await listAccountCascadeDependents(CLIENT, ACCT);
    expect(res).toEqual({ transfers: [], rothConversions: [] });
  });

  it("includes a transfer where the account is the SOURCE", async () => {
    setTable(transfers, [
      { id: "t1", name: "Fund Roth", client_id: CLIENT, source_account_id: ACCT, target_account_id: "other" },
    ]);
    const res = await listAccountCascadeDependents(CLIENT, ACCT);
    expect(res.transfers).toEqual([{ id: "t1", name: "Fund Roth" }]);
  });

  it("includes a transfer where the account is the TARGET", async () => {
    setTable(transfers, [
      { id: "t2", name: "Top up checking", client_id: CLIENT, source_account_id: "other", target_account_id: ACCT },
    ]);
    const res = await listAccountCascadeDependents(CLIENT, ACCT);
    expect(res.transfers).toEqual([{ id: "t2", name: "Top up checking" }]);
  });

  it("includes a roth conversion where the account is the DESTINATION", async () => {
    setTable(rothConversions, [
      { id: "r1", name: "Annual conversion", client_id: CLIENT, destination_account_id: ACCT },
    ]);
    const res = await listAccountCascadeDependents(CLIENT, ACCT);
    expect(res.rothConversions).toEqual([{ id: "r1", name: "Annual conversion" }]);
  });

  it("does NOT return another client's transfer with the same account id (clientId guard)", async () => {
    setTable(transfers, [
      { id: "t3", name: "Cross-tenant", client_id: OTHER_CLIENT, source_account_id: ACCT, target_account_id: "x" },
    ]);
    setTable(rothConversions, [
      { id: "r3", name: "Cross-tenant roth", client_id: OTHER_CLIENT, destination_account_id: ACCT },
    ]);
    const res = await listAccountCascadeDependents(CLIENT, ACCT);
    expect(res).toEqual({ transfers: [], rothConversions: [] });
  });

  it("ignores transfers/conversions that reference a different account", async () => {
    setTable(transfers, [
      { id: "t4", name: "Unrelated", client_id: CLIENT, source_account_id: "zzz", target_account_id: "yyy" },
    ]);
    setTable(rothConversions, [
      { id: "r4", name: "Unrelated roth", client_id: CLIENT, destination_account_id: "zzz" },
    ]);
    const res = await listAccountCascadeDependents(CLIENT, ACCT);
    expect(res).toEqual({ transfers: [], rothConversions: [] });
  });
});
