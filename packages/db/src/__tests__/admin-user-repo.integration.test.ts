import { describe, it, expect, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../schema";
import { getActingContext } from "@foundry/auth";
import { drizzleAdminUserRepo } from "../admin-user-repo-drizzle";

const TEST_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const client = TEST_URL ? neon(TEST_URL) : null;
const db = client ? drizzle(client, { schema }) : null;

const CLERK_ID = `clerk_test_${Date.now()}`;

maybeDescribe("drizzleAdminUserRepo end-to-end", () => {
  afterAll(async () => {
    if (!db) return;
    await db.execute(
      sql`DELETE FROM admin_users WHERE clerk_user_id = ${CLERK_ID}`,
    );
  });

  it("lazy-creates the admin row on first call", async () => {
    const ctx = await getActingContext({
      clerkSession: {
        userId: CLERK_ID,
        emailAddress: "integ@foundry.test",
        role: "support",
      },
      repo: drizzleAdminUserRepo,
    });
    expect(ctx.role).toBe("support");
    expect(ctx.impersonation).toBeNull();
  });

  it("is idempotent on the second call — reuses the existing row", async () => {
    const ctx = await getActingContext({
      clerkSession: {
        userId: CLERK_ID,
        emailAddress: "integ@foundry.test",
        role: "support",
      },
      repo: drizzleAdminUserRepo,
    });
    const result = await db!.execute(sql`
      SELECT count(*)::int AS n FROM admin_users WHERE clerk_user_id = ${CLERK_ID}
    `);
    const rows = (Array.isArray(result) ? result : result.rows) as Array<{
      n: number;
    }>;
    expect(rows[0].n).toBe(1);
    expect(ctx.actorAdminId).toBeDefined();
  });
});
