/**
 * Backfill `accounts.sub_type` for annuity accounts from the tax treatment
 * their contract already records.
 *
 * An annuity's Account Type dropdown used to offer only "Other", so every
 * annuity row carries `sub_type = 'other'`. The dropdown now states the tax
 * treatment — `account_sub_type` gained `qualified` / `non_qualified` /
 * `tax_free`, spelled identically to `annuity_tax_treatment` — so each account
 * takes the treatment its `annuity_contracts` row already holds. An annuity
 * with no contract row takes the contract column's own default,
 * `non_qualified`.
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION: Postgres refuses to USE a new enum
 * value in the transaction that ADDED it (SQLSTATE 55P04), and drizzle's
 * migrator wraps EVERY pending migration in ONE transaction
 * (`drizzle-orm/pg-core/dialect.js` → `migrate()` → `session.transaction`).
 * So a backfill migration cannot be split from `0252_dark_pixie.sql` by
 * putting it in its own file — the two would still share a transaction and
 * fail. The error fires even when the UPDATE matches zero rows, so a fresh
 * database is not a way around it either.
 *
 * Run AFTER migration 0252 is applied, once per environment:
 *   npx tsx scripts/backfill-annuity-sub-type.ts
 *
 * Idempotent: it only touches rows still on 'other', so a re-run is a no-op.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local without a runtime dep. Shell-sourcing breaks on `&` in the
// Neon URL, so scripts read it directly. Must run before `../src/db` is
// evaluated (it constructs a Pool from process.env.DATABASE_URL at module
// load) — so the db import is dynamic, inside main().
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
} catch {
  // .env.local absent — fall through to the env-var check below.
}

export async function backfillAnnuitySubType(): Promise<{
  fromContract: number;
  defaulted: number;
  remainingOther: number;
}> {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  // Two statements, not one: an annuity with no contract row has no treatment
  // to copy, and a LEFT JOIN with a COALESCE would quietly hand every such
  // account the same default without saying how many got it.
  const fromContract = await db.execute(sql`
    UPDATE "accounts" AS a
    SET "sub_type" = c."tax_treatment"::text::"account_sub_type"
    FROM "annuity_contracts" AS c
    WHERE c."account_id" = a."id"
      AND a."category" = 'annuity'
      AND a."sub_type" = 'other'
  `);

  const defaulted = await db.execute(sql`
    UPDATE "accounts"
    SET "sub_type" = 'non_qualified'
    WHERE "category" = 'annuity'
      AND "sub_type" = 'other'
  `);

  // `db.execute` hands back a pg Result, not an array — `.rows` is the data.
  const check = await db.execute(sql`
    SELECT count(*)::int AS remaining
    FROM "accounts"
    WHERE "category" = 'annuity' AND "sub_type" = 'other'
  `);
  const remaining = (check.rows as { remaining: number }[])[0].remaining;

  return {
    fromContract: fromContract.rowCount ?? 0,
    defaulted: defaulted.rowCount ?? 0,
    remainingOther: remaining,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set (and .env.local did not supply it).");
    process.exit(1);
  }
  const host = process.env.DATABASE_URL.match(/ep-[a-z0-9-]+/)?.[0] ?? "unknown";
  console.log(`Backfilling annuity sub_type against ${host}…`);

  const r = await backfillAnnuitySubType();
  console.log(`  from their contract : ${r.fromContract}`);
  console.log(`  defaulted to non-Q  : ${r.defaulted}`);
  console.log(`  still 'other'       : ${r.remainingOther}`);

  if (r.remainingOther !== 0) {
    console.error("FAILED: annuity accounts are still on 'other'.");
    process.exit(1);
  }
  console.log("Done.");
  process.exit(0);
}

if (process.argv[1]?.endsWith("backfill-annuity-sub-type.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
