import { describe, expect, test } from 'vitest';
import { requireRole, type ActingContext } from '@foundry/auth';

describe('/audit role guard', () => {
  test('support role is rejected', () => {
    const ctx: ActingContext = { actorAdminId: 'a', role: 'support', impersonation: null };
    expect(() => requireRole(ctx, ['operator', 'superadmin'])).toThrow();
  });
  test('operator role is accepted', () => {
    const ctx: ActingContext = { actorAdminId: 'a', role: 'operator', impersonation: null };
    expect(() => requireRole(ctx, ['operator', 'superadmin'])).not.toThrow();
  });
});
