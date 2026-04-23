import { neon } from "@neondatabase/serverless";

async function main() {
  const db = neon(process.env.DATABASE_URL!);
  const rows = await db.query(
    `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5`,
  );
  console.log(JSON.stringify(rows, null, 2));
}
main();
