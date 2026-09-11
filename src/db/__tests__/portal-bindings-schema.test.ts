import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = join(process.cwd(), "src/db/migrations");

function migration0263(): string {
  const name = readdirSync(MIG_DIR).find((f) => f.startsWith("0263_"));
  if (!name) throw new Error("migration 0263 not found");
  return readFileSync(join(MIG_DIR, name), "utf8");
}

describe("migration 0263", () => {
  it("creates the partial unique index over live statuses only, covering (client_id, clerk_user_id)", () => {
    const sql = migration0263();
    // Isolate the whole statement so the assertions below are checked against
    // this index specifically, not "somewhere in the file".
    const match = sql.match(/CREATE[^;]*"portal_bindings_live_idx"[^;]*/i);
    expect(match).not.toBeNull();
    const stmt = match![0];

    // Must be UNIQUE — a plain (non-unique) index sharing this name would
    // provide zero protection against a duplicate live binding.
    expect(stmt).toMatch(/^CREATE UNIQUE INDEX/i);

    // Must cover exactly the (household, login) pair. A unique index on just
    // "id" (the primary key) — unique by construction, safety-useless — would
    // pass a name-only + WHERE-only check while enforcing nothing.
    expect(stmt).toMatch(/\(\s*"client_id"\s*,\s*"clerk_user_id"\s*\)/);

    // Must restrict to exactly the two live statuses.
    expect(stmt).toMatch(/where\s+status\s+in\s+\('pending',\s*'active'\)/i);
  });

  it("backfills every bound client as an active binding, with the right column mapping", () => {
    const sql = migration0263();
    const match = sql.match(/INSERT INTO "portal_bindings"[^;]*;/i);
    expect(match).not.toBeNull();
    const stmt = match![0];

    // Target column order must put (client_id, clerk_user_id, status) first,
    // since INSERT ... SELECT has no named parameters — the SELECT list below
    // lines up with this list purely by position.
    expect(stmt).toMatch(/\(\s*"client_id"\s*,\s*"clerk_user_id"\s*,\s*"status"/i);

    // clients.id -> client_id, clients.clerk_user_id -> clerk_user_id, and the
    // literal status written must be 'active' (not 'pending' or any other
    // value) — in that same positional order, so a swapped mapping or a wrong
    // status can't sneak past a substring-only check.
    expect(stmt).toMatch(/SELECT\s+"id"\s*,\s*"clerk_user_id"\s*,\s*'active'/i);

    expect(stmt).toMatch(/WHERE\s+"clerk_user_id"\s+IS\s+NOT\s+NULL/i);
  });

  it("is additive — it must NOT drop the legacy column, with or without the COLUMN keyword or quoting", () => {
    // Dropping clerk_user_id here breaks the deployed code the instant it is
    // applied. That drop belongs in 0264, after Deploy 2 is live.
    //
    // Postgres makes the COLUMN keyword optional (`DROP "clerk_user_id"` is a
    // valid, working column drop, identical in effect to
    // `DROP COLUMN "clerk_user_id"`) and quoting is likewise optional — a
    // guard anchored on the literal text "DROP COLUMN" misses exactly the
    // shorthand form that causes the outage this test exists to prevent.
    expect(migration0263()).not.toMatch(/drop\s+(column\s+)?(if\s+exists\s+)?"?clerk_user_id"?/i);
  });
});
