import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInsertedRows: Array<{ table: string; values: Record<string, unknown> }> = [];

const makeMockInsert = (tableName: string) => ({
  values: vi.fn().mockImplementation((v: Record<string, unknown>) => {
    mockInsertedRows.push({ table: tableName, values: v });
    return Promise.resolve();
  }),
});

vi.mock('@clerk/nextjs/server', () => ({
  currentUser: vi.fn().mockResolvedValue({
    id: 'clerk_admin_1',
    emailAddresses: [{ emailAddress: 'admin@test.com' }],
    publicMetadata: { role: 'superadmin' },
  }),
}));

vi.mock('@foundry/auth', () => ({
  getActingContext: vi.fn().mockResolvedValue({
    actorAdminId: 'admin-uuid-1',
    role: 'superadmin',
    impersonation: null,
  }),
  signImpersonationToken: vi.fn().mockResolvedValue({
    token: 'mock.jwt.token',
    tokenHash: Buffer.from('hash'),
  }),
}));

const mockDb = {
  insert: vi.fn().mockImplementation((table: { tableName?: string }) => {
    const name = table?.tableName ?? 'unknown';
    return makeMockInsert(name);
  }),
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock('@foundry/db', () => ({
  db: mockDb,
}));

vi.mock('@foundry/db/admin-user-repo-drizzle', () => ({
  drizzleAdminUserRepo: {},
}));

vi.mock('@foundry/db/admin-scope', () => ({
  adminQuery: vi.fn().mockImplementation(
    (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  ),
}));

vi.mock('@foundry/db/schema', () => ({
  adminImpersonationSessions: { tableName: 'admin_impersonation_sessions' },
  auditLog: { tableName: 'audit_log' },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/impersonation/start', () => {
  beforeEach(() => {
    mockInsertedRows.length = 0;
    mockDb.insert.mockClear();
    process.env.IMPERSONATION_SIGNING_SECRET = 'a-secret-that-is-at-least-32-chars-long!!';
    process.env.WEB_APP_URL = 'https://web.example';
  });

  it('returns a redirect URL containing the JWT token', async () => {
    const { POST } = await import('../route');

    const req = new NextRequest('http://localhost/api/impersonation/start', {
      method: 'POST',
      body: JSON.stringify({
        advisorClerkUserId: 'user_adv_123',
        firmId: 'firm_abc',
        reason: 'Support ticket #42',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redirect).toMatch(/^https:\/\/web\.example\/api\/impersonation\/handoff\?t=.+/);
    expect(body.redirect).toContain('mock.jwt.token');
  });

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('../route');

    const req = new NextRequest('http://localhost/api/impersonation/start', {
      method: 'POST',
      body: JSON.stringify({ advisorClerkUserId: 'user_adv_123' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('inserts a row into admin_impersonation_sessions', async () => {
    const { POST } = await import('../route');

    const req = new NextRequest('http://localhost/api/impersonation/start', {
      method: 'POST',
      body: JSON.stringify({
        advisorClerkUserId: 'user_adv_123',
        firmId: 'firm_abc',
        reason: 'Support ticket #42',
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    await POST(req);

    // db.insert should have been called twice: sessions + audit_log
    expect(mockDb.insert).toHaveBeenCalledTimes(2);

    const sessionInsert = mockInsertedRows.find(
      (r) => r.table === 'admin_impersonation_sessions',
    );
    expect(sessionInsert).toBeDefined();
    expect(sessionInsert?.values).toMatchObject({
      adminUserId: 'admin-uuid-1',
      advisorClerkUserId: 'user_adv_123',
      firmId: 'firm_abc',
      reason: 'Support ticket #42',
    });
  });
});
