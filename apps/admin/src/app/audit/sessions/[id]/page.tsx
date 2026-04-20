import { currentUser } from '@clerk/nextjs/server';
import { getActingContext, requireRole } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';
import { sql } from 'drizzle-orm';
import type { AdminRole } from '@foundry/auth';

type SessionRow = {
  id: string;
  admin_user_id: string;
  advisor_clerk_user_id: string;
  firm_id: string;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  reason: string;
};

type AuditRow = {
  id: string;
  created_at: string;
  actor_id: string;
  acting_as_advisor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
};

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const clerkUser = await currentUser();
  const clerkSession = clerkUser
    ? {
        userId: clerkUser.id,
        emailAddress: clerkUser.emailAddresses[0]?.emailAddress ?? '',
        role: (clerkUser.publicMetadata?.role as AdminRole | undefined),
      }
    : null;

  const ctx = await getActingContext({ clerkSession, repo: drizzleAdminUserRepo });
  requireRole(ctx, ['operator', 'superadmin']);

  const [session, auditRows] = await adminQuery(ctx, async () => {
    const sessionRes = await db.execute(sql`
      SELECT id, admin_user_id, advisor_clerk_user_id, firm_id, started_at, expires_at, ended_at, reason
        FROM admin_impersonation_sessions
       WHERE id = ${id}
       LIMIT 1
    `);
    const auditRes = await db.execute(sql`
      SELECT id, created_at, actor_id, acting_as_advisor_id, action, resource_type, resource_id
        FROM audit_log
       WHERE impersonation_session_id = ${id}
       ORDER BY created_at DESC
       LIMIT 500
    `);
    return [sessionRes.rows[0] as SessionRow | undefined, auditRes.rows as AuditRow[]];
  });

  if (!session) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Session not found</h1>
        <a href="/audit">Back to Audit Log</a>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>Impersonation Session</h1>
      <a href="/audit">Back to Audit Log</a>

      <dl style={{ margin: '16px 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>Session ID</dt><dd>{session.id}</dd>
        <dt>Admin User ID</dt><dd>{session.admin_user_id}</dd>
        <dt>Advisor</dt><dd>{session.advisor_clerk_user_id}</dd>
        <dt>Firm</dt><dd>{session.firm_id}</dd>
        <dt>Started</dt><dd>{session.started_at}</dd>
        <dt>Expires</dt><dd>{session.expires_at}</dd>
        <dt>Ended</dt><dd>{session.ended_at ?? '—'}</dd>
        <dt>Reason</dt><dd>{session.reason}</dd>
      </dl>

      <h2>Audit Events ({auditRows.length})</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            {['created_at', 'actor_id', 'acting_as_advisor_id', 'action', 'resource_type', 'resource_id'].map((h) => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {auditRows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: '4px 8px' }}>{r.created_at}</td>
              <td style={{ padding: '4px 8px' }}>{r.actor_id}</td>
              <td style={{ padding: '4px 8px' }}>{r.acting_as_advisor_id ?? '—'}</td>
              <td style={{ padding: '4px 8px' }}>{r.action}</td>
              <td style={{ padding: '4px 8px' }}>{r.resource_type}</td>
              <td style={{ padding: '4px 8px' }}>{r.resource_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
