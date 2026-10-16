// A database branch where Forge's setup scripts never ran has none of the
// LangGraph tables. purgeForgeHistory runs inside every household and firm
// purge, so it must skip a missing table rather than fail the purge.
// Fake transaction at the execute seam; no database.
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { purgeForgeHistory } from "../purge-history";

/** The first statement is the existence lookup; it answers with `existing`. */
function fakeTx(existing: string[]) {
  const statements: string[] = [];
  const tx = {
    execute: async (query: SQL) => {
      statements.push(new PgDialect().sqlToQuery(query).sql);
      return { rows: statements.length === 1 ? existing.map((relname) => ({ relname })) : [] };
    },
  };
  return { tx: tx as never, deletes: () => statements.slice(1) };
}

describe("purgeForgeHistory on a branch without Forge's tables", () => {
  it("issues no delete when none of the tables exist", async () => {
    const { tx, deletes } = fakeTx([]);
    await purgeForgeHistory(tx, { firmId: "org_a" });
    expect(deletes()).toEqual([]);
  });

  it("deletes only from the tables that exist", async () => {
    const { tx, deletes } = fakeTx(["store"]);
    await purgeForgeHistory(tx, { firmId: "org_a" });
    expect(deletes()).toEqual([expect.stringContaining('delete from public."store"')]);
  });
});
