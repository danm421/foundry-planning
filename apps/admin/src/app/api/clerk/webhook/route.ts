import { handleClerkAdminWebhook } from '@foundry/auth';
import { drizzleAdminUserRepo } from '@foundry/db/admin-user-repo-drizzle';
import { db } from '@foundry/db';

// db imported to ensure the module is initialised (drizzleAdminUserRepo
// references db internally, but explicit import keeps the bundle happy).
void db;

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return new Response('server not configured', { status: 500 });
  return handleClerkAdminWebhook(req, drizzleAdminUserRepo, secret);
}
