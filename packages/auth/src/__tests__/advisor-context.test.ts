import { describe, expect, test } from 'vitest';
import { getAdvisorContext, runWithAdvisorContext, type AdvisorContext } from '../advisor-context';

describe('AdvisorContext ALS', () => {
  test('getAdvisorContext throws when no context is set and no clerk resolver provided', async () => {
    await expect(getAdvisorContext()).rejects.toThrow(/no advisor context/i);
  });

  test('runWithAdvisorContext populates the context for the duration of the callback', async () => {
    const ctx: AdvisorContext = {
      kind: 'impersonated',
      clerkUserId: 'user_advisor',
      firmId: 'firm_abc',
      actorAdminId: 'admin_1',
      sessionId: 'sess_1',
      role: 'superadmin',
    };
    const result = await runWithAdvisorContext(ctx, async () => {
      const got = await getAdvisorContext();
      return got;
    });
    expect(result).toEqual(ctx);
  });

  test('nested runs isolate their contexts', async () => {
    const outer: AdvisorContext = { kind: 'advisor', clerkUserId: 'a1', firmId: 'f1' };
    const inner: AdvisorContext = { kind: 'advisor', clerkUserId: 'a2', firmId: 'f2' };
    const seen = await runWithAdvisorContext(outer, async () => {
      const o1 = await getAdvisorContext();
      const i = await runWithAdvisorContext(inner, () => getAdvisorContext());
      const o2 = await getAdvisorContext();
      return { o1, i, o2 };
    });
    expect(seen.o1.clerkUserId).toBe('a1');
    expect(seen.i.clerkUserId).toBe('a2');
    expect(seen.o2.clerkUserId).toBe('a1');
  });
});
