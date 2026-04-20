import { describe, expect, test } from 'vitest';
import { runWithAdvisorContext } from '@foundry/auth';
import { getCurrentFirmId } from '../firm-id';

describe('getCurrentFirmId', () => {
  test('returns advisor firm from ALS when set', async () => {
    const firm = await runWithAdvisorContext(
      { kind: 'advisor', clerkUserId: 'u1', firmId: 'firm_a' },
      () => getCurrentFirmId(),
    );
    expect(firm).toBe('firm_a');
  });

  test('returns impersonated advisor firm when context is impersonated', async () => {
    const firm = await runWithAdvisorContext(
      { kind: 'impersonated', clerkUserId: 'u1', firmId: 'firm_adv', actorAdminId: 'a', sessionId: 's', role: 'superadmin' },
      () => getCurrentFirmId(),
    );
    expect(firm).toBe('firm_adv');
  });
});
