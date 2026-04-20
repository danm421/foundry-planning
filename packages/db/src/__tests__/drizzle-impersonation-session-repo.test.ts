import { afterEach, describe, expect, test } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { drizzleImpersonationSessionRepo } from '../drizzle-impersonation-session-repo';
import { getTestDb, cleanupSession, seedSession } from './helpers/impersonation-session';

describe('drizzleImpersonationSessionRepo', () => {
  const db = getTestDb();
  const repo = drizzleImpersonationSessionRepo(db);
  const created: string[] = [];
  afterEach(async () => { for (const id of created.splice(0)) await cleanupSession(db, id); });

  test('loadActive returns the row when active', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000 });
    created.push(sessionId);
    const row = await repo.loadActive(sessionId);
    expect(row?.sessionId).toBe(sessionId);
  });

  test('loadActive returns null when ended', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000, endedAt: new Date() });
    created.push(sessionId);
    expect(await repo.loadActive(sessionId)).toBeNull();
  });

  test('loadActive returns null when expired', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: -60_000 });
    created.push(sessionId);
    expect(await repo.loadActive(sessionId)).toBeNull();
  });

  test('consumeHandoffToken is one-shot (CAS semantics)', async () => {
    const token = randomBytes(32);
    const hash = createHash('sha256').update(token).digest();
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000, handoffTokenHash: hash });
    created.push(sessionId);
    const first = await repo.consumeHandoffToken(hash);
    expect(first?.sessionId).toBe(sessionId);
    const second = await repo.consumeHandoffToken(hash);
    expect(second).toBeNull();
  });

  test('consumeHandoffToken rejects when session already ended', async () => {
    const token = randomBytes(32);
    const hash = createHash('sha256').update(token).digest();
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000, handoffTokenHash: hash, endedAt: new Date() });
    created.push(sessionId);
    expect(await repo.consumeHandoffToken(hash)).toBeNull();
  });

  test('end sets ended_at and subsequent loadActive returns null', async () => {
    const { sessionId } = await seedSession(db, { expiresInMs: 60_000 });
    created.push(sessionId);
    await repo.end(sessionId);
    expect(await repo.loadActive(sessionId)).toBeNull();
  });
});
