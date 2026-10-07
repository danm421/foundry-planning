import { clerkClient, type User } from "@clerk/nextjs/server";

/**
 * The one Clerk account that holds `email` as a VERIFIED address, or null.
 *
 * Clerk's email filter also lists accounts that merely added the address and
 * never confirmed it, so the filter alone is no proof of who owns a mailbox.
 * Anything that hands access to "whoever owns this email" goes through here:
 * an unverified holder is skipped, and two verified holders resolve to nobody
 * rather than to whichever Clerk happened to list first.
 */
export async function findUserByVerifiedEmail(email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const cc = await clerkClient();
  const { data } = await cc.users.getUserList({ emailAddress: [normalized] });
  const holders = data.filter((user) =>
    user.emailAddresses.some(
      (a) => a.emailAddress.toLowerCase() === normalized && a.verification?.status === "verified",
    ),
  );
  return holders.length === 1 ? holders[0] : null;
}
