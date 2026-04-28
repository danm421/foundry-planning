/**
 * Plan 3a Task 4 — Validate migration 0058 file content.
 *
 * Run: npx tsx scripts/test-migration-0058.local.ts
 *
 * Asserts the migration file contains all expected DDL fragments. Does NOT apply
 * the migration — the executor does that manually (npx drizzle-kit migrate).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION_FILE = path.join(
  ROOT,
  "src/db/migrations/0058_charitable_deduction_and_recipient_check.sql",
);

function main() {
  if (!existsSync(MIGRATION_FILE)) {
    throw new Error(`Migration file not found: ${MIGRATION_FILE}`);
  }
  const sql = readFileSync(MIGRATION_FILE, "utf8");
  console.log(`Migration file size: ${sql.length} bytes`);

  const expected = [
    "BEGIN;",
    'CREATE TYPE "public"."charity_type" AS ENUM(\'public\', \'private\')',
    'ADD COLUMN "charity_type" charity_type DEFAULT \'public\' NOT NULL',
    "gifts_recipient_family_member_year_idx",
    "gifts_recipient_external_beneficiary_year_idx",
    "USING btree",
    'WHERE "recipient_family_member_id" IS NOT NULL',
    'WHERE "recipient_external_beneficiary_id" IS NOT NULL',
    "COMMIT;",
  ];
  const missing: string[] = [];
  for (const fragment of expected) {
    if (!sql.includes(fragment)) {
      missing.push(fragment);
    }
  }

  if (missing.length > 0) {
    console.error("✗ Migration is missing expected fragments:");
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.log("✓ All expected DDL fragments present");
  console.log("");
  console.log("Next steps for the executor:");
  console.log("  1. Apply migration to dev branch:  npx drizzle-kit migrate");
  console.log("  2. Or apply via Neon MCP to a throwaway branch:");
  console.log("     mcp__Neon__create_branch  (creates a dev clone)");
  console.log("     mcp__Neon__run_sql  with the file contents");
  console.log("     mcp__Neon__compare_database_schema  vs. parent");
}

main();
