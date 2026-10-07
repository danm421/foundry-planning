import { findUserByVerifiedEmail } from "@/lib/clerk-verified-user";

/**
 * Resolve an email to a Foundry (Clerk) user. Returns null when no user owns
 * that email as a verified address — sharing requires an existing user (no
 * invite/pending state).
 */
export async function resolveRecipientByEmail(
  email: string,
): Promise<{ userId: string; email: string } | null> {
  const user = await findUserByVerifiedEmail(email);
  if (!user) return null;
  return { userId: user.id, email: email.trim().toLowerCase() };
}
