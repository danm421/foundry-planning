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
  it("creates the partial unique index over live statuses only", () => {
    const sql = migration0263();
    expect(sql).toMatch(/portal_bindings_live_idx/);
    expect(sql).toMatch(/where\s+status\s+in\s+\('pending',\s*'active'\)/i);
  });

  it("backfills every bound client as an active binding", () => {
    const sql = migration0263();
    expect(sql).toMatch(/INSERT INTO "portal_bindings"/);
    expect(sql).toMatch(/WHERE "clerk_user_id" IS NOT NULL/);
  });

  it("is additive — it must NOT drop the legacy column", () => {
    // Dropping clerk_user_id here breaks the deployed code the instant it is
    // applied. That drop belongs in 0264, after Deploy 2 is live.
    expect(migration0263()).not.toMatch(/DROP COLUMN/i);
  });
});
