import { describe, expect, test, vi } from 'vitest';
import {
  signImpersonationToken,
  verifyImpersonationToken,
  hashImpersonationToken,
  ImpersonationTokenError,
} from '../impersonation-token';

const SECRET = 'x'.repeat(32);

const claims = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  actorAdminId: '22222222-2222-2222-2222-222222222222',
  advisorClerkUserId: 'user_advisor',
  firmId: 'firm_abc',
};

describe('impersonation tokens', () => {
  test('round-trip signs and verifies', async () => {
    const { token, tokenHash } = await signImpersonationToken(claims, SECRET);
    expect(tokenHash).toBeInstanceOf(Buffer);
    expect(tokenHash.length).toBe(32);
    const decoded = await verifyImpersonationToken(token, SECRET);
    expect(decoded.sessionId).toBe(claims.sessionId);
    expect(decoded.actorAdminId).toBe(claims.actorAdminId);
    expect(decoded.advisorClerkUserId).toBe(claims.advisorClerkUserId);
    expect(decoded.firmId).toBe(claims.firmId);
  });

  test('hashImpersonationToken is stable and equals the tokenHash from signImpersonationToken', async () => {
    const { token, tokenHash } = await signImpersonationToken(claims, SECRET);
    const again = hashImpersonationToken(token);
    expect(again.equals(tokenHash)).toBe(true);
  });

  test('expired token is rejected', async () => {
    vi.useFakeTimers();
    const { token } = await signImpersonationToken(claims, SECRET);
    vi.advanceTimersByTime(120_000);
    await expect(verifyImpersonationToken(token, SECRET)).rejects.toBeInstanceOf(ImpersonationTokenError);
    vi.useRealTimers();
  });

  test('wrong secret is rejected', async () => {
    const { token } = await signImpersonationToken(claims, SECRET);
    await expect(verifyImpersonationToken(token, 'y'.repeat(32))).rejects.toBeInstanceOf(ImpersonationTokenError);
  });

  test('tampered claims are rejected', async () => {
    const { token } = await signImpersonationToken(claims, SECRET);
    const parts = token.split('.');
    const tampered = parts[0] + '.' + Buffer.from('{"sessionId":"hax"}').toString('base64url') + '.' + parts[2];
    await expect(verifyImpersonationToken(tampered, SECRET)).rejects.toBeInstanceOf(ImpersonationTokenError);
  });
});
