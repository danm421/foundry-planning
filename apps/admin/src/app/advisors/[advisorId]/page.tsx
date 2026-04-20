import { currentUser } from '@clerk/nextjs/server';
import { getActingContext } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';
import { sql } from 'drizzle-orm';
import type { AdminRole } from '@foundry/auth';
import ImpersonateButton from './impersonate-button';

export default async function AdvisorDetailPage({
  params,
}: {
  params: Promise<{ advisorId: string }>;
}) {
  const { advisorId } = await params;
  const decodedAdvisorId = decodeURIComponent(advisorId);

  const clerkUser = await currentUser();
  const clerkSession = clerkUser
    ? {
        userId: clerkUser.id,
        emailAddress: clerkUser.emailAddresses[0]?.emailAddress ?? '',
        role: (clerkUser.publicMetadata?.role as AdminRole | undefined),
      }
    : null;

  const ctx = await getActingContext({ clerkSession, repo: drizzleAdminUserRepo });

  const clients = await adminQuery(ctx, async () => {
    const res = await db.execute(sql`
      SELECT id, first_name, last_name, firm_id, advisor_id
        FROM clients
       WHERE advisor_id = ${decodedAdvisorId}
       ORDER BY last_name, first_name
       LIMIT 100
    `);
    return res.rows as Array<{
      id: string;
      first_name: string;
      last_name: string;
      firm_id: string;
      advisor_id: string;
    }>;
  });

  const firmId = clients[0]?.firm_id ?? '';

  return (
    <main style={{ padding: 24 }}>
      <p><a href="/advisors">← Advisors</a></p>
      <h1>Advisor: {decodedAdvisorId}</h1>
      <p>Firm: {firmId}</p>

      {firmId && (
        <ImpersonateButton advisorClerkUserId={decodedAdvisorId} firmId={firmId} />
      )}

      <h2>Clients ({clients.length})</h2>
      <ul>
        {clients.map((c) => (
          <li key={c.id}>
            {c.last_name}, {c.first_name} — <code>{c.id}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
