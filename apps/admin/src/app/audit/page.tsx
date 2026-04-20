import { currentUser } from '@clerk/nextjs/server';
import { getActingContext, requireRole } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';
import { sql } from 'drizzle-orm';
import type { AdminRole } from '@foundry/auth';

type Filters = { actor?: string; advisor?: string; from?: string; to?: string; action?: string };

type AuditRow = {
  id: string;
  created_at: string;
  actor_id: string;
  acting_as_advisor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  impersonation_session_id: string | null;
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Filters> }) {
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

  const f = await searchParams;

  const rows = await adminQuery(ctx, async () => {
    const res = await db.execute(sql`
      SELECT id, created_at, actor_id, acting_as_advisor_id, action, resource_type, resource_id, impersonation_session_id
        FROM audit_log
       WHERE true
         ${f.actor ? sql`AND actor_id = ${f.actor}` : sql``}
         ${f.advisor ? sql`AND acting_as_advisor_id = ${f.advisor}` : sql``}
         ${f.from ? sql`AND created_at >= ${f.from}` : sql``}
         ${f.to ? sql`AND created_at <= ${f.to}` : sql``}
         ${f.action ? sql`AND action = ${f.action}` : sql``}
       ORDER BY created_at DESC
       LIMIT 500
    `);
    return res.rows as AuditRow[];
  });

  const exportUrl = `/audit/export?${new URLSearchParams(
    Object.entries(f).filter(([, v]) => Boolean(v)) as [string, string][]
  ).toString()}`;

  return (
    <main style={{ padding: 24 }}>
      <h1>Audit Log</h1>

      {/* Filter form */}
      <form style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input name="actor" defaultValue={f.actor} placeholder="Actor ID" />
        <input name="advisor" defaultValue={f.advisor} placeholder="Advisor ID" />
        <input name="action" defaultValue={f.action} placeholder="Action" />
        <input name="from" defaultValue={f.from} placeholder="From (ISO date)" type="date" />
        <input name="to" defaultValue={f.to} placeholder="To (ISO date)" type="date" />
        <button type="submit">Filter</button>
        <a href={exportUrl} style={{ marginLeft: 8 }}>Export CSV</a>
      </form>

      <p>{rows.length} row{rows.length !== 1 ? 's' : ''}</p>

      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            {['created_at', 'actor_id', 'acting_as_advisor_id', 'action', 'resource_type', 'resource_id', 'session_id'].map((h) => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: '4px 8px' }}>{r.created_at}</td>
              <td style={{ padding: '4px 8px' }}>{r.actor_id}</td>
              <td style={{ padding: '4px 8px' }}>{r.acting_as_advisor_id ?? '—'}</td>
              <td style={{ padding: '4px 8px' }}>{r.action}</td>
              <td style={{ padding: '4px 8px' }}>{r.resource_type}</td>
              <td style={{ padding: '4px 8px' }}>{r.resource_id}</td>
              <td style={{ padding: '4px 8px' }}>
                {r.impersonation_session_id
                  ? <a href={`/audit/sessions/${r.impersonation_session_id}`}>{r.impersonation_session_id.slice(0, 8)}…</a>
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
