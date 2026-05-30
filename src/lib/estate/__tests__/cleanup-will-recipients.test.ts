import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for `cleanupWillRecipientReferences` (audit F13).
 *
 * `will_bequest_recipients.recipient_id` / `will_residuary_recipients.recipient_id`
 * are polymorphic raw UUIDs (dispatched by `recipient_kind`) with NO foreign key,
 * so deleting a referenced family member / external beneficiary / entity would
 * otherwise leave a dangling id → silently wrong estate projections. This helper
 * is the app-layer cleanup that removes those rows on delete.
 *
 * To make the (kind + id) filter testable we swap drizzle's `eq` / `and` for
 * inspectable predicate builders and feed the helper a stub `tx` whose
 * `delete(table).where(pred)` evaluates the predicate over in-memory rows. If a
 * filter (kind OR id) is dropped from the helper, a "must survive" row gets
 * deleted and the corresponding assertion fails — exactly the regression we want
 * CI to catch.
 */

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Col = { name: string };
  type Pred =
    | { k: "eq"; name: string; val: unknown }
    | { k: "and"; conds: Pred[] };
  const tables: Record<string, Row[]> = {};
  function evalPred(pred: Pred, row: Row): boolean {
    if (pred.k === "eq") return row[pred.name] === pred.val;
    return pred.conds.every((c) => evalPred(c, row));
  }
  return {
    tables,
    evalPred,
    eq: (col: Col, val: unknown): Pred => ({ k: "eq", name: col.name, val }),
    and: (...conds: Pred[]): Pred => ({ k: "and", conds }),
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: h.eq, and: h.and };
});

import { getTableName } from "drizzle-orm";
import { willBequestRecipients, willResiduaryRecipients } from "@/db/schema";
import { cleanupWillRecipientReferences } from "@/lib/estate/cleanup-will-recipients";

// Stub tx: delete(table).where(pred) removes matching rows from the in-memory table.
const tx = {
  delete(table: Parameters<typeof getTableName>[0]) {
    const name = getTableName(table);
    return {
      where(pred: Parameters<typeof h.evalPred>[0]) {
        const before = h.tables[name] ?? [];
        h.tables[name] = before.filter((r) => !h.evalPred(pred, r));
        return Promise.resolve({ rowCount: before.length - h.tables[name].length });
      },
    };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function setTable(table: Parameters<typeof getTableName>[0], rows: Record<string, unknown>[]) {
  h.tables[getTableName(table)] = rows;
}

const FM = "ffffffff-ffff-ffff-ffff-ffffffffff01"; // the deleted family member
const OTHER = "ffffffff-ffff-ffff-ffff-ffffffffff02"; // a different family member

beforeEach(() => {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
});

describe("cleanupWillRecipientReferences", () => {
  it("deletes bequest + residuary rows that point at the deleted family member", async () => {
    setTable(willBequestRecipients, [
      { id: "b1", recipient_kind: "family_member", recipient_id: FM },
    ]);
    setTable(willResiduaryRecipients, [
      { id: "r1", recipient_kind: "family_member", recipient_id: FM },
    ]);

    await cleanupWillRecipientReferences(tx, "family_member", FM);

    expect(h.tables[getTableName(willBequestRecipients)]).toHaveLength(0);
    expect(h.tables[getTableName(willResiduaryRecipients)]).toHaveLength(0);
  });

  it("leaves rows of a DIFFERENT kind that happen to share the id (kind filter guard)", async () => {
    setTable(willBequestRecipients, [
      { id: "b1", recipient_kind: "entity", recipient_id: FM },
    ]);
    setTable(willResiduaryRecipients, []);

    await cleanupWillRecipientReferences(tx, "family_member", FM);

    expect(h.tables[getTableName(willBequestRecipients)]).toHaveLength(1);
  });

  it("leaves same-kind rows pointing at a DIFFERENT id (id filter guard)", async () => {
    setTable(willBequestRecipients, [
      { id: "b1", recipient_kind: "family_member", recipient_id: OTHER },
    ]);
    setTable(willResiduaryRecipients, [
      { id: "r1", recipient_kind: "family_member", recipient_id: OTHER },
    ]);

    await cleanupWillRecipientReferences(tx, "family_member", FM);

    expect(h.tables[getTableName(willBequestRecipients)]).toHaveLength(1);
    expect(h.tables[getTableName(willResiduaryRecipients)]).toHaveLength(1);
  });

  it("never touches spouse rows (null recipient_id)", async () => {
    setTable(willResiduaryRecipients, [
      { id: "r1", recipient_kind: "spouse", recipient_id: null },
    ]);

    await cleanupWillRecipientReferences(tx, "family_member", FM);

    expect(h.tables[getTableName(willResiduaryRecipients)]).toHaveLength(1);
  });

  it("removes only the matching rows from a mixed set", async () => {
    setTable(willBequestRecipients, [
      { id: "b1", recipient_kind: "family_member", recipient_id: FM }, // gone
      { id: "b2", recipient_kind: "family_member", recipient_id: OTHER }, // stays
      { id: "b3", recipient_kind: "entity", recipient_id: FM }, // stays
    ]);
    setTable(willResiduaryRecipients, [
      { id: "r1", recipient_kind: "family_member", recipient_id: FM }, // gone
      { id: "r2", recipient_kind: "spouse", recipient_id: null }, // stays
    ]);

    await cleanupWillRecipientReferences(tx, "family_member", FM);

    expect(
      (h.tables[getTableName(willBequestRecipients)] ?? []).map((r) => r.id),
    ).toEqual(["b2", "b3"]);
    expect(
      (h.tables[getTableName(willResiduaryRecipients)] ?? []).map((r) => r.id),
    ).toEqual(["r2"]);
  });
});
