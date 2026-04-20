/**
 * Golden-path integration test for audited mutations on client resources.
 *
 * Verifies that auditedMutation emits an audit_log row when running inside
 * an impersonated AdvisorContext — using the real production inserter against
 * the dev database. Skips automatically when DEV_DATABASE_URL is not set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { runWithAdvisorContext, type AdvisorContext } from '@foundry/auth';
// Import directly from package src to avoid the DATABASE_URL eager init in @foundry/db index.ts
import { auditedMutation, __resetAuditInserterForTest } from '../../../../../../../../packages/db/src/audited-mutation';
import {
  getTestDb,
  seedSession,
  cleanupSession,
  seedClient,
  cleanupClient,
} from '../../../../../../../../packages/db/src/__tests__/helpers/impersonation-session';

const DEV_URL = process.env.DEV_DATABASE_URL;
const maybeDescribe = DEV_URL ? describe : describe.skip;

maybeDescribe('auditedMutation — client.update golden path (live DB)', () => {
  // Lazy-init db so getTestDb() only runs when the suite actually executes.
  let db: ReturnType<typeof getTestDb>;
  const firmId = `firm_audit_test_${Date.now()}`;
  let sessionId: string;
  let adminId: string;
  let clientId: string;

  beforeAll(async () => {
    db = getTestDb();
    // Ensure production inserter is active (not a test mock).
    __resetAuditInserterForTest();

    // Seed an impersonation session so the FK on audit_log resolves.
    ({ sessionId, adminId } = await seedSession(db, { expiresInMs: 60_000 }));

    // Seed a minimal client row.
    clientId = await seedClient(db, { firmId });
  });

  afterAll(async () => {
    await cleanupClient(db, clientId);
    await cleanupSession(db, sessionId);

    // audit_log is append-only — disable the no-delete trigger for teardown.
    await db.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete`);
    await db.execute(sql`DELETE FROM audit_log WHERE firm_id = ${firmId}`);
    await db.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete`);
  });

  it('writes one audit_log row when a mutation runs under an impersonated context', async () => {
    const ctx: AdvisorContext = {
      kind: 'impersonated',
      clerkUserId: 'user_test_advisor',
      firmId,
      actorAdminId: adminId,
      sessionId,
      role: 'superadmin',
    };

    // Count rows before
    const before = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM audit_log WHERE firm_id = ${firmId}`,
    );
    const beforeCount = Number((before.rows[0] as { cnt: string }).cnt);

    // Run a simulated client.update through auditedMutation
    await runWithAdvisorContext(ctx, () =>
      auditedMutation(
        {
          action: 'client.update',
          resourceType: 'client',
          resourceId: clientId,
          metadata: { before: { firstName: 'Test' }, after: { firstName: 'Updated' } },
        },
        async () => {
          // Inner fn is a no-op here — we only test that the audit row is emitted.
        },
      ),
    );

    // Count rows after
    const after = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM audit_log WHERE firm_id = ${firmId}`,
    );
    const afterCount = Number((after.rows[0] as { cnt: string }).cnt);

    expect(afterCount).toBe(beforeCount + 1);

    // Verify the row content
    const rows = await db.execute(sql`
      SELECT action, resource_type, resource_id, acting_as_advisor_id, impersonation_session_id
        FROM audit_log
       WHERE firm_id = ${firmId}
       ORDER BY created_at DESC
       LIMIT 1
    `);
    const row = rows.rows[0] as {
      action: string;
      resource_type: string;
      resource_id: string;
      acting_as_advisor_id: string;
      impersonation_session_id: string;
    };
    expect(row.action).toBe('client.update');
    expect(row.resource_type).toBe('client');
    expect(row.resource_id).toBe(clientId);
    expect(row.acting_as_advisor_id).toBe('user_test_advisor');
    expect(row.impersonation_session_id).toBe(sessionId);
  });

  it('does NOT write an audit_log row when running as a plain advisor (not impersonated)', async () => {
    const ctx: AdvisorContext = {
      kind: 'advisor',
      clerkUserId: 'user_regular_advisor',
      firmId,
    };

    const before = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM audit_log WHERE firm_id = ${firmId}`,
    );
    const beforeCount = Number((before.rows[0] as { cnt: string }).cnt);

    await runWithAdvisorContext(ctx, () =>
      auditedMutation(
        { action: 'client.update', resourceType: 'client', resourceId: clientId },
        async () => {},
      ),
    );

    const after = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM audit_log WHERE firm_id = ${firmId}`,
    );
    const afterCount = Number((after.rows[0] as { cnt: string }).cnt);

    expect(afterCount).toBe(beforeCount);
  });
});
