import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DB } from './index';

export async function seedE2ESuperadmin(db: DB, clerkUserId: string, email: string): Promise<string> {
  const id = randomUUID();
  const res = await db.execute(sql`
    INSERT INTO admin_users (id, clerk_user_id, email, role)
    VALUES (${id}, ${clerkUserId}, ${email}, 'superadmin')
    ON CONFLICT (clerk_user_id) DO UPDATE SET role = 'superadmin'
    RETURNING id
  `);
  return (res.rows[0] as any).id;
}

export async function seedE2EAdvisorAndClient(db: DB): Promise<{ advisorClerkUserId: string; firmId: string; clientId: string }> {
  // Column name confirmation: clients.advisor_id (not advisor_clerk_user_id) per schema.ts.
  // Required NOT NULL columns without DB defaults: date_of_birth, retirement_age, plan_end_age.
  const firmId = 'firm_e2e';
  const advisorClerkUserId = 'user_e2e_advisor';
  const clientId = randomUUID();
  await db.execute(sql`
    INSERT INTO clients (id, firm_id, first_name, last_name, advisor_id, date_of_birth, retirement_age, plan_end_age)
    VALUES (${clientId}, ${firmId}, 'E2E', 'Client', ${advisorClerkUserId}, '1970-01-01', 65, 95)
    ON CONFLICT (id) DO NOTHING
  `);
  return { advisorClerkUserId, firmId, clientId };
}
