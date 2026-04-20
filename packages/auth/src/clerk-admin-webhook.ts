import { Webhook, WebhookVerificationError } from 'svix';
import type { AdminUserRepo } from './admin-user-repo';
import type { AdminRole } from './context';

type ClerkUserCreatedOrUpdated = {
  type: 'user.created' | 'user.updated';
  data: {
    id: string;
    email_addresses?: Array<{ email_address: string }>;
    public_metadata?: Record<string, unknown>;
  };
};
type ClerkUserDeleted = { type: 'user.deleted'; data: { id: string } };
type ClerkEvent = ClerkUserCreatedOrUpdated | ClerkUserDeleted;

const KNOWN_ROLES: readonly AdminRole[] = ['support', 'operator', 'superadmin'];

export async function handleClerkAdminWebhook(
  req: Request,
  repo: AdminUserRepo,
  signingSecret: string,
): Promise<Response> {
  const body = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  let event: ClerkEvent;
  try {
    event = new Webhook(signingSecret).verify(body, headers) as ClerkEvent;
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new Response('invalid signature', { status: 401 });
    }
    throw err;
  }

  try {
    if (event.type === 'user.created' || event.type === 'user.updated') {
      const email = event.data.email_addresses?.[0]?.email_address ?? '';
      const role = resolveRole(event.data.public_metadata?.['role']);
      if (!role) return new Response('invalid or missing role', { status: 400 });
      await repo.upsert({ clerkUserId: event.data.id, email, role });
    } else if (event.type === 'user.deleted') {
      await repo.delete(event.data.id);
    }
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'repo error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

function resolveRole(v: unknown): AdminRole | null {
  return typeof v === 'string' && (KNOWN_ROLES as readonly string[]).includes(v) ? (v as AdminRole) : null;
}
