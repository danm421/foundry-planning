import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

// Load .env.local without a runtime dep. Shell-sourcing breaks on `&` in the
// Neon URL, so scripts read it directly.
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
} catch {}

import { neon } from "@neondatabase/serverless";

type JournalEntry = { idx: number; tag: string; when: number };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set. Pass it inline or source .env.local first.");
    process.exit(1);
  }

  const sql = neon(url);
  const host = new URL(url).host;
  console.log(`Checking migrations against ${host}\n`);

  const appliedRows = (await sql`
    SELECT hash FROM drizzle.__drizzle_migrations
  `) as Array<{ hash: string }>;
  const appliedHashes = new Set(appliedRows.map((r) => r.hash));

  const journalPath = "src/db/migrations/meta/_journal.json";
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };

  const missing: JournalEntry[] = [];
  for (const entry of journal.entries) {
    const sqlText = readFileSync(join("src/db/migrations", entry.tag + ".sql"), "utf8");
    const hash = createHash("sha256").update(sqlText).digest("hex");
    if (!appliedHashes.has(hash)) missing.push(entry);
  }

  console.log(`Applied: ${appliedRows.length}   Journal: ${journal.entries.length}\n`);

  if (missing.length === 0) {
    console.log("In sync — nothing to apply.");
    return;
  }

  console.log(`Unapplied migrations (${missing.length}):`);
  for (const m of missing) console.log(`  - ${m.tag}`);
  console.log("\nTo apply: run `npx drizzle-kit migrate` with DATABASE_URL pointing at this database.");
  console.log("If drizzle-kit refuses (e.g. after a renumbering), apply the SQL by hand and insert the hash into drizzle.__drizzle_migrations.");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
