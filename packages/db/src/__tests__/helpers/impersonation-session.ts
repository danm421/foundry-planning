import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { randomUUID } from 'node:crypto';
import * as schema from '../../schema';
import { sql } from 'drizzle-orm';

export function getTestDb() {
  const url = process.env.DEV_DATABASE_URL;
  if (!url) throw new Error('DEV_DATABASE_URL not set — required for live-DB tests');
  return drizzle(neon(url), { schema });
}

export async function seedSession(db: ReturnType<typeof getTestDb>, opts: {
  expiresInMs: number;
  handoffTokenHash?: Buffer;
  endedAt?: Date;
  sessionId?: string;
}) {
  const adminId = await ensureTestAdmin(db);
  const sessionId = opts.sessionId ?? randomUUID();
  await db.execute(sql`
    INSERT INTO admin_impersonation_sessions
      (id, admin_user_id, advisor_clerk_user_id, firm_id, expires_at, ended_at, handoff_token_hash, reason)
    VALUES
      (${sessionId}, ${adminId}, 'user_test_advisor', 'firm_test',
       now() + (${opts.expiresInMs}::int || ' milliseconds')::interval,
       ${opts.endedAt ?? null}, ${opts.handoffTokenHash ?? null}, 'test')
  `);
  return { sessionId, adminId };
}

export async function cleanupSession(db: ReturnType<typeof getTestDb>, sessionId: string) {
  await db.execute(sql`DELETE FROM admin_impersonation_sessions WHERE id = ${sessionId}`);
}

async function ensureTestAdmin(db: ReturnType<typeof getTestDb>): Promise<string> {
  const rows = await db.execute(sql`SELECT id FROM admin_users WHERE clerk_user_id = 'test_admin' LIMIT 1`);
  if (rows.rows.length) return rows.rows[0].id as string;
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO admin_users (id, clerk_user_id, email, role)
    VALUES (${id}, 'test_admin', 'test-admin@example.com', 'superadmin')
  `);
  return id;
}
