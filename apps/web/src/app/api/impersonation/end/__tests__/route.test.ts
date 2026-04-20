import { afterEach, describe, expect, test, vi } from 'vitest';
import { runWithAdvisorContext } from '@foundry/auth';
import { POST } from '../route';
import { seedSession, cleanupSession, getTestDb } from '../../../../../../../../packages/db/src/__tests__/helpers/impersonation-session';

// audit_log is append-only in the DB (trigger rejects deletes), so we cannot
// clean up audit rows in afterEach. Mock the inserter to keep the test focused
// on session lifecycle + cookie + redirect behaviour.
vi.mock('@foundry/db/admin-scope', () => ({
  defaultAuditInserter: vi.fn().mockResolvedValue(undefined),
}));

process.env.ADMIN_APP_URL = 'https://admin.example';

describe('POST /api/impersonation/end', () => {
  const db = getTestDb();
  const created: string[] = [];
  afterEach(async () => { for (const id of created.splice(0)) await cleanupSession(db, id); });

  test('ends the session, clears cookie, redirects to admin', async () => {
    const { sessionId, adminId } = await seedSession(db, { expiresInMs: 60_000 });
    created.push(sessionId);
    const req = new Request('https://web.example/api/impersonation/end', { method: 'POST' });

    const res = await runWithAdvisorContext(
      { kind: 'impersonated', clerkUserId: 'u', firmId: 'f', actorAdminId: adminId, sessionId, role: 'superadmin' },
      () => POST(req as any),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://admin.example/');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie.toLowerCase()).toContain('foundry_impersonation=');
    expect(setCookie.toLowerCase()).toContain('max-age=0');
  });

  test('returns 400 when not in impersonated context', async () => {
    const req = new Request('https://web.example/api/impersonation/end', { method: 'POST' });
    const res = await runWithAdvisorContext(
      { kind: 'advisor', clerkUserId: 'u', firmId: 'f' },
      () => POST(req as any),
    );
    expect(res.status).toBe(400);
  });
});
