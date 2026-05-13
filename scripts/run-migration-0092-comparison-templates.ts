import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Running comparison-templates backfill...");

  console.log("  Backfilling client_comparisons from client_comparison_layouts...");
  const hasOld = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'client_comparison_layouts'
    LIMIT 1
  `;
  if (hasOld.length > 0) {
    await sql`
      INSERT INTO client_comparisons (id, firm_id, client_id, name, layout, source_template_id, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        firm_id,
        client_id,
        'Default',
        layout,
        NULL,
        COALESCE(updated_at, NOW()),
        COALESCE(updated_at, NOW())
      FROM client_comparison_layouts
      ON CONFLICT DO NOTHING
    `;
    console.log(`    inserted (rows reported by driver may be undefined)`);

    console.log("  Dropping client_comparison_layouts...");
    await sql`DROP TABLE client_comparison_layouts`;
  } else {
    console.log("  client_comparison_layouts not present, skipping backfill + drop.");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Migration script failed:", err);
  process.exit(1);
});
