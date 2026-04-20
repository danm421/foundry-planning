import { currentUser } from '@clerk/nextjs/server';
import { getActingContext } from '@foundry/auth';
import { adminQuery } from '@foundry/db/admin-scope';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';
import { sql } from 'drizzle-orm';
import type { AdminRole } from '@foundry/auth';

export default async function AdvisorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  const clerkUser = await currentUser();
  const clerkSession = clerkUser
    ? {
        userId: clerkUser.id,
        emailAddress: clerkUser.emailAddresses[0]?.emailAddress ?? '',
        role: (clerkUser.publicMetadata?.role as AdminRole | undefined),
      }
    : null;

  const ctx = await getActingContext({ clerkSession, repo: drizzleAdminUserRepo });

  const rows = await adminQuery(ctx, async () => {
    const res = await db.execute(sql`
      SELECT DISTINCT firm_id, advisor_id
        FROM clients
       WHERE ${q ? sql`(advisor_id ILIKE ${'%' + q + '%'} OR firm_id ILIKE ${'%' + q + '%'})` : sql`true`}
       ORDER BY firm_id
       LIMIT 100
    `);
    return res.rows as Array<{ firm_id: string; advisor_id: string }>;
  });

  return (
    <main style={{ padding: 24 }}>
      <h1>Advisors</h1>
      <form>
        <input name="q" defaultValue={q} placeholder="search firm or advisor id" />
        <button type="submit">Search</button>
      </form>
      <ul>
        {rows.map((r) => (
          <li key={r.advisor_id}>
            <a href={`/advisors/${encodeURIComponent(r.advisor_id)}`}>{r.advisor_id}</a> — {r.firm_id}
          </li>
        ))}
      </ul>
    </main>
  );
}
