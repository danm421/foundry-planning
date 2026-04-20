import { describe, expect, test, vi } from 'vitest';
import { Webhook } from 'svix';
import { handleClerkAdminWebhook } from '../clerk-admin-webhook';
import type { AdminUserRepo } from '../index';

const SECRET = 'whsec_' + Buffer.from('x'.repeat(24)).toString('base64');

function signedRequest(payload: object): Request {
  const body = JSON.stringify(payload);
  const wh = new Webhook(SECRET);
  const id = 'msg_' + Math.random().toString(36).slice(2);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = wh.sign(id, new Date(Number(ts) * 1000), body);
  return new Request('https://example.com/webhook', {
    method: 'POST',
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': sig,
      'content-type': 'application/json',
    },
  });
}

function mockRepo(): AdminUserRepo & { _calls: any[] } {
  const calls: any[] = [];
  return {
    _calls: calls,
    upsert: vi.fn(async (u) => { calls.push(['upsert', u]); }),
    delete: vi.fn(async (id) => { calls.push(['delete', id]); }),
  } as unknown as AdminUserRepo & { _calls: any[] };
}

describe('handleClerkAdminWebhook', () => {
  test('dispatches user.created to repo.upsert', async () => {
    const repo = mockRepo();
    const req = signedRequest({
      type: 'user.created',
      data: { id: 'user_1', email_addresses: [{ email_address: 'a@b.c' }], public_metadata: { role: 'operator' } },
    });
    const res = await handleClerkAdminWebhook(req, repo, SECRET);
    expect(res.status).toBe(200);
    expect(repo._calls[0][0]).toBe('upsert');
    expect(repo._calls[0][1].clerkUserId).toBe('user_1');
  });

  test('dispatches user.deleted to repo.delete', async () => {
    const repo = mockRepo();
    const req = signedRequest({ type: 'user.deleted', data: { id: 'user_1' } });
    const res = await handleClerkAdminWebhook(req, repo, SECRET);
    expect(res.status).toBe(200);
    expect(repo._calls[0][0]).toBe('delete');
  });

  test('invalid signature returns 401', async () => {
    const req = new Request('https://example.com/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'user.created', data: { id: 'x' } }),
      headers: { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,wrongsig', 'content-type': 'application/json' },
    });
    const repo = mockRepo();
    const res = await handleClerkAdminWebhook(req, repo, SECRET);
    expect(res.status).toBe(401);
    expect(repo._calls).toEqual([]);
  });
});
