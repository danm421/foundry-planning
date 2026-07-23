import { clerkClient } from "@clerk/nextjs/server";

/**
 * Resolve an email to a Foundry (Clerk) user. Returns null when no user owns
 * that email — sharing requires an existing user (no invite/pending state).
 */
export async function resolveRecipientByEmail(
  email: string,
): Promise<{ userId: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const cc = await clerkClient();
  const list = await cc.users.getUserList({ emailAddress: [normalized] });
  const user = list.data[0];
  if (!user) return null;
  return { userId: user.id, email: normalized };
}
