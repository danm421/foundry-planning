import { currentUser } from '@clerk/nextjs/server';
import { getActingContext } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';
import { sql } from 'drizzle-orm';
import type { AdminRole } from '@foundry/auth';

export default async function DashboardPage() {
  const clerkUser = await currentUser();
  const clerkSession = clerkUser
    ? {
        userId: clerkUser.id,
        emailAddress: clerkUser.emailAddresses[0]?.emailAddress ?? '',
        role: (clerkUser.publicMetadata?.role as AdminRole | undefined),
      }
    : null;

  const ctx = await getActingContext({ clerkSession, repo: drizzleAdminUserRepo });

  const recent = await adminQuery(ctx, async () => {
    const rows = await db.execute(sql`
      SELECT id, action, resource_type, resource_id, created_at
        FROM audit_log
       WHERE actor_id = ${ctx.actorAdminId}
       ORDER BY created_at DESC
       LIMIT 10
    `);
    return rows.rows;
  });

  return (
    <main style={{ padding: 24 }}>
      <h1>Admin Dashboard</h1>
      <p>Role: {ctx.role}</p>
      <h2>Your recent actions</h2>
      <ul>
        {(recent as any[]).map((r) => (
          <li key={r.id}>
            {r.created_at} — {r.action} {r.resource_type}/{r.resource_id}
          </li>
        ))}
      </ul>
      <p><a href="/advisors">Browse advisors →</a></p>
      <p><a href="/audit">Audit log →</a></p>
    </main>
  );
}
