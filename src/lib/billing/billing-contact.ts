import { auth, clerkClient } from "@clerk/nextjs/server";

export type BillingContact = { userId: string; email: string | null };

type Membership = {
  role: string;
  createdAt: number;
  publicUserData?: { userId?: string | null; identifier?: string | null } | null;
};

async function emailFor(m: Membership): Promise<string | null> {
  if (m.publicUserData?.identifier) return m.publicUserData.identifier;
  const uid = m.publicUserData?.userId;
  if (!uid) return null;
  const cc = await clerkClient();
  const user = await cc.users.getUser(uid);
  return user.emailAddresses[0]?.emailAddress ?? null;
}

/**
 * The firm's billing contact, resolved through a lockout-safe chain:
 *   1. publicMetadata.billing_contact_userId, if still a member
 *   2. (transitional, pre-migration) the org:owner member
 *   3. earliest-joined org:admin
 *   4. earliest-joined member
 * Returns null only for a member-less org. Authoritative — makes Clerk reads.
 */
export async function resolveBillingContact(orgId: string): Promise<BillingContact | null> {
  const cc = await clerkClient();
  const org = await cc.organizations.getOrganization({ organizationId: orgId });
  const meta = (org.publicMetadata ?? {}) as Record<string, unknown>;
  const pinned = typeof meta.billing_contact_userId === "string" ? meta.billing_contact_userId : null;

  const list = (
    await cc.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 })
  ).data as Membership[];
  if (list.length === 0) return null;

  const byUser = (uid: string) => list.find((m) => m.publicUserData?.userId === uid);
  const earliest = (role: string) =>
    list.filter((m) => m.role === role).sort((a, b) => a.createdAt - b.createdAt)[0];

  const chosen =
    (pinned ? byUser(pinned) : undefined) ??
    list.find((m) => m.role === "org:owner") ??
    earliest("org:admin") ??
    [...list].sort((a, b) => a.createdAt - b.createdAt)[0];

  const userId = chosen.publicUserData?.userId;
  if (!userId) return null;
  return { userId, email: await emailFor(chosen) };
}

export async function resolveBillingContactUserId(orgId: string): Promise<string | null> {
  return (await resolveBillingContact(orgId))?.userId ?? null;
}

/**
 * Is the CURRENT request's user the billing contact? Fast path: the pinned
 * contact is in the session token (no API call). Slow path (un-pinned /
 * pre-migration orgs only): authoritative resolve.
 */
export async function currentUserIsBillingContact(): Promise<boolean> {
  const { userId, orgId, sessionClaims } = await auth();
  if (!userId || !orgId) return false;
  const meta =
    (sessionClaims as { org_public_metadata?: Record<string, unknown> })?.org_public_metadata ?? {};
  const pinned = typeof meta.billing_contact_userId === "string" ? meta.billing_contact_userId : null;
  if (pinned) return pinned === userId;
  return (await resolveBillingContactUserId(orgId)) === userId;
}
