import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

async function main() {
  const db = neon(process.env.DATABASE_URL!);
  const path = "src/db/migrations/0039_trust_data_model.sql";
  const sql = readFileSync(path, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    console.log("executing:", stmt.slice(0, 80));
    await db.query(stmt);
  }
  // drizzle-kit migrate already inserted a row into drizzle.__drizzle_migrations
  // despite silently skipping the SQL (neon-http quirk). Leave it — hash matches.
  void createHash;
}
main();
