import { afterEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signImpersonationToken } from '@foundry/auth';
import { GET } from '../route';
import { seedSession, cleanupSession, getTestDb } from '../../../../../../../../packages/db/src/__tests__/helpers/impersonation-session';

const SECRET = 'x'.repeat(32);
process.env.IMPERSONATION_SIGNING_SECRET = SECRET;

async function seedWithSignedToken(db: ReturnType<typeof getTestDb>, opts: { expiresInMs: number; endedAt?: Date } = { expiresInMs: 60_000 }) {
  // 1. pick a sessionId up-front
  const sessionId = randomUUID();
  // 2. sign a token using that real sessionId
  const { token, tokenHash } = await signImpersonationToken(
    { sessionId, actorAdminId: randomUUID(), advisorClerkUserId: 'user_adv', firmId: 'firm_x' },
    SECRET,
  );
  // 3. seed a session row with the matching hash AND the chosen id
  await seedSession(db, { ...opts, handoffTokenHash: tokenHash, sessionId });
  return { sessionId, token };
}

describe('GET /api/impersonation/handoff', () => {
  const db = getTestDb();
  const created: string[] = [];
  afterEach(async () => { for (const id of created.splice(0)) await cleanupSession(db, id); });

  test('valid JWT + unconsumed hash → sets cookie and 302s to /clients', async () => {
    const { sessionId, token } = await seedWithSignedToken(db);
    created.push(sessionId);
    const req = new Request(`https://web.example/api/impersonation/handoff?t=${token}`);
    const res = await GET(req as any);

    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/clients');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('foundry_impersonation=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });

  test('replay returns 401', async () => {
    const { sessionId, token } = await seedWithSignedToken(db);
    created.push(sessionId);
    const req1 = new Request(`https://web.example/api/impersonation/handoff?t=${token}`);
    const res1 = await GET(req1 as any);
    expect(res1.status).toBe(302);
    const req2 = new Request(`https://web.example/api/impersonation/handoff?t=${token}`);
    const res2 = await GET(req2 as any);
    expect(res2.status).toBe(401);
  });

  test('invalid signature returns 401', async () => {
    const tampered = 'eyJhbGciOiJIUzI1NiJ9.eyJzZXNzaW9uSWQiOiJ4In0.garbage';
    const req = new Request(`https://web.example/api/impersonation/handoff?t=${tampered}`);
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  test('missing token returns 400', async () => {
    const req = new Request('https://web.example/api/impersonation/handoff');
    const res = await GET(req as any);
    expect(res.status).toBe(400);
  });
});
