import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../schema";
import { adminQuery, writeAuditLog, defaultAuditInserter } from "../admin-scope";
import type { ActingContext } from "@foundry/auth";

const TEST_URL = process.env.TEST_DATABASE_URL;
const maybeDescribe = TEST_URL ? describe : describe.skip;

const client = TEST_URL ? neon(TEST_URL) : null;
const db = client ? drizzle(client, { schema }) : null;

const TEST_FIRM = `firm_test_${Date.now()}`;
const ctx: ActingContext = {
  actorAdminId: "00000000-0000-0000-0000-000000000001",
  role: "superadmin",
  impersonation: {
    sessionId: "00000000-0000-0000-0000-000000000abc",
    advisorClerkUserId: "user_advisor_test",
    firmId: TEST_FIRM,
  },
};

maybeDescribe("audit_log triggers (live DB)", () => {
  beforeAll(async () => {
    if (!db) return;
    await db.execute(sql`
      INSERT INTO admin_users (id, clerk_user_id, email, role)
      VALUES (${ctx.actorAdminId}::uuid, 'clerk_test_admin', 'test@foundry.test', 'superadmin')
      ON CONFLICT (clerk_user_id) DO NOTHING;
    `);
    await db.execute(sql`
      INSERT INTO admin_impersonation_sessions (id, admin_user_id, advisor_clerk_user_id, firm_id, expires_at, reason)
      VALUES (${ctx.impersonation!.sessionId}::uuid, ${ctx.actorAdminId}::uuid, 'user_advisor_test', ${TEST_FIRM}, now() + interval '1 hour', 'test run')
      ON CONFLICT (id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    if (!db) return;
    await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete`);
    await db.execute(sql`DELETE FROM audit_log WHERE firm_id = ${TEST_FIRM}`);
    await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete`);
    await db.execute(sql`DELETE FROM admin_impersonation_sessions WHERE firm_id = ${TEST_FIRM}`);
  });

  it("inserts populate row_hash and link prev_hash across rows", async () => {
    await adminQuery(ctx, async () => {
      await writeAuditLog(
        { action: "test.one", resourceType: "t", resourceId: "r1" },
        defaultAuditInserter,
      );
      await writeAuditLog(
        { action: "test.two", resourceType: "t", resourceId: "r2" },
        defaultAuditInserter,
      );
    });
    const result = await db!.execute(sql`
      SELECT resource_id, prev_hash, row_hash
        FROM audit_log
       WHERE firm_id = ${TEST_FIRM}
       ORDER BY created_at, id
    `);
    const rows = (Array.isArray(result) ? result : result.rows) as Array<{
      resource_id: string;
      prev_hash: Buffer | null;
      row_hash: Buffer;
    }>;
    expect(rows.length).toBe(2);
    expect(rows[0].row_hash).not.toBeNull();
    expect(rows[0].prev_hash).toBeNull();
    const prev = rows[1].prev_hash;
    const firstHash = rows[0].row_hash;
    const toBuf = (b: Buffer | Uint8Array) =>
      Buffer.isBuffer(b) ? b : Buffer.from(b);
    expect(toBuf(prev!).equals(toBuf(firstHash))).toBe(true);
  });

  const rootCause = (err: unknown): string => {
    let cur: unknown = err;
    const seen = new Set<unknown>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const msg = (cur as { message?: string }).message;
      if (msg && /append-only/i.test(msg)) return msg;
      cur = (cur as { cause?: unknown }).cause;
    }
    return (err as { message?: string }).message ?? String(err);
  };

  it("UPDATE on audit_log is rejected", async () => {
    try {
      await db!.execute(sql`
        UPDATE audit_log SET action = 'tampered' WHERE firm_id = ${TEST_FIRM}
      `);
      throw new Error("Expected UPDATE to be rejected");
    } catch (err) {
      expect(rootCause(err)).toMatch(/append-only/i);
    }
  });

  it("DELETE on audit_log is rejected", async () => {
    try {
      await db!.execute(sql`
        DELETE FROM audit_log WHERE firm_id = ${TEST_FIRM}
      `);
      throw new Error("Expected DELETE to be rejected");
    } catch (err) {
      expect(rootCause(err)).toMatch(/append-only/i);
    }
  });
});
