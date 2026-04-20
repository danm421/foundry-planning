import { describe, expect, test, vi, beforeEach } from 'vitest';
import { runWithAdvisorContext, type AdvisorContext } from '@foundry/auth';
import { auditedMutation, __setAuditInserterForTest } from '../audited-mutation';

describe('auditedMutation', () => {
  const inserter = vi.fn(async () => {});
  beforeEach(() => {
    inserter.mockClear();
    __setAuditInserterForTest(inserter);
  });

  test('runs inner fn and writes audit row when impersonated', async () => {
    const ctx: AdvisorContext = {
      kind: 'impersonated', clerkUserId: 'adv', firmId: 'f1',
      actorAdminId: 'admin_x', sessionId: 'sess_y', role: 'superadmin',
    };
    const result = await runWithAdvisorContext(ctx, () =>
      auditedMutation(
        { action: 'client.update', resourceType: 'client', resourceId: 'c1', metadata: { name: 'n' } },
        async () => 'OK'
      )
    );
    expect(result).toBe('OK');
    expect(inserter).toHaveBeenCalledTimes(1);
    const entry = inserter.mock.calls[0][0];
    expect(entry.actorAdminId).toBe('admin_x');
    expect(entry.impersonationSessionId).toBe('sess_y');
    expect(entry.actingAsAdvisorId).toBe('adv');
    expect(entry.firmId).toBe('f1');
    expect(entry.action).toBe('client.update');
  });

  test('runs inner fn and skips audit when not impersonated', async () => {
    const ctx: AdvisorContext = { kind: 'advisor', clerkUserId: 'adv', firmId: 'f1' };
    const result = await runWithAdvisorContext(ctx, () =>
      auditedMutation(
        { action: 'client.update', resourceType: 'client', resourceId: 'c1' },
        async () => 'OK'
      )
    );
    expect(result).toBe('OK');
    expect(inserter).not.toHaveBeenCalled();
  });

  test('audit is written AFTER the inner fn (so failed mutations are not audited)', async () => {
    const ctx: AdvisorContext = {
      kind: 'impersonated', clerkUserId: 'adv', firmId: 'f1',
      actorAdminId: 'a', sessionId: 's', role: 'superadmin',
    };
    await expect(runWithAdvisorContext(ctx, () =>
      auditedMutation(
        { action: 'client.update', resourceType: 'client', resourceId: 'c1' },
        async () => { throw new Error('boom'); }
      )
    )).rejects.toThrow('boom');
    expect(inserter).not.toHaveBeenCalled();
  });
});
