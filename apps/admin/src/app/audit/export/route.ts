import { currentUser } from '@clerk/nextjs/server';
import { getActingContext, requireRole } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';
import { sql } from 'drizzle-orm';
import type { AdminRole } from '@foundry/auth';

export const runtime = 'nodejs';

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

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const actor = searchParams.get('actor') ?? undefined;
  const advisor = searchParams.get('advisor') ?? undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const action = searchParams.get('action') ?? undefined;

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

  const rows = await adminQuery(ctx, async () => {
    const res = await db.execute(sql`
      SELECT id, created_at, actor_id, acting_as_advisor_id, action, resource_type, resource_id, impersonation_session_id
        FROM audit_log
       WHERE true
         ${actor ? sql`AND actor_id = ${actor}` : sql``}
         ${advisor ? sql`AND acting_as_advisor_id = ${advisor}` : sql``}
         ${from ? sql`AND created_at >= ${from}` : sql``}
         ${to ? sql`AND created_at <= ${to}` : sql``}
         ${action ? sql`AND action = ${action}` : sql``}
       ORDER BY created_at DESC
       LIMIT 500
    `);
    return res.rows as AuditRow[];
  });

  const headers = ['id', 'created_at', 'actor_id', 'acting_as_advisor_id', 'action', 'resource_type', 'resource_id', 'impersonation_session_id'];
  const csvLines = [
    headers.join(','),
    ...rows.map((r) =>
      [r.id, r.created_at, r.actor_id, r.acting_as_advisor_id, r.action, r.resource_type, r.resource_id, r.impersonation_session_id]
        .map(escapeCsv)
        .join(',')
    ),
  ];
  const csv = csvLines.join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
