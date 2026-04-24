import { neon } from "@neondatabase/serverless";

async function main() {
  const db = neon(process.env.DATABASE_URL!);
  const rows = await db.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = 'entities'
       AND column_name IN ('trust_sub_type','is_irrevocable','trustee','exemption_consumed')
     ORDER BY column_name`,
  );
  console.log(JSON.stringify(rows, null, 2));
}
main();
