import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ALL_CATEGORIZED_FIRM_TABLES } from "../purge-coverage";

// Live dev-DB drift guard for firm-purge completeness (audit
// 2026-07-07-verify-first-hotlist F2). Reads the REAL schema so the coverage
// lists can't be fooled by a stale hand-list. Runs against the Neon dev branch
// (DATABASE_URL in .env.local, loaded by vitest.setup.ts); skipped when absent.
describe.skipIf(!process.env.DATABASE_URL)("firm-purge coverage drift guard", () => {
  it("every table with a firm_id column has a decided purge fate", async () => {
    const result = await db.execute(
      sql.raw(
        `SELECT table_name FROM information_schema.columns
         WHERE column_name = 'firm_id' AND table_schema = 'public'
         ORDER BY table_name`,
      ),
    );
    const rows = (result as unknown as { rows: { table_name: string }[] }).rows;
    const uncategorized = rows
      .map((r) => r.table_name)
      .filter((t) => !ALL_CATEGORIZED_FIRM_TABLES.has(t));
    expect(
      uncategorized,
      `Tables with firm_id but no purge fate: ${uncategorized.join(", ")}. ` +
        `Add each to PURGED_FIRM_TABLES (delete it in purgeFirmById), ` +
        `CASCADE_COVERED_FIRM_TABLES (verify its FK cascades from a purged parent), ` +
        `or RETAIN_ALLOWLIST_FIRM_TABLES (document why it is kept).`,
    ).toEqual([]);
  });
});
