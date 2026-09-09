import { clerkClient } from "@clerk/nextjs/server";
import type { User } from "@clerk/nextjs/server";

/**
 * The advisor-facing summary of a client's portal login. Everything here comes
 * from Clerk, not our DB — the `clients.clerk_user_id` binding is only a
 * pointer, so the name, email, and sign-in history live on Clerk's side.
 *
 * Deliberately excludes the Clerk user id from anything the advisor reads on
 * screen: "Manage Portal" has to be presentable with a client in the room, and
 * `user_3J5uf2feh…` is a debug surface. The id stays available to callers for
 * support/tooltip use.
 */
export interface PortalAccount {
  clerkUserId: string;
  /** Name as the client entered it at sign-up. Null when they gave none. */
  name: string | null;
  /** Primary email — the address a sign-in link is sent to. */
  email: string | null;
  lastSignInAt: Date | null;
  twoFactorEnabled: boolean;
  /** Clerk locked the account after repeated failed sign-ins. */
  locked: boolean;
}

/** The address Clerk would send to: the primary if one is set, else the first
 *  on file. The single home for that rule — the sign-in-link route sends to the
 *  same address this card shows. */
export function primaryEmailOf(user: User): string | null {
  return (
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
      ?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null
  );
}

/** Full name as the client typed it at sign-up, or null. */
export function displayNameOf(user: User): string | null {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || null;
}

export function toPortalAccount(user: User): PortalAccount {
  return {
    clerkUserId: user.id,
    name: displayNameOf(user),
    email: primaryEmailOf(user),
    lastSignInAt: user.lastSignInAt ? new Date(user.lastSignInAt) : null,
    twoFactorEnabled: user.twoFactorEnabled,
    locked: user.locked,
  };
}

/**
 * Load the portal login behind `clerkUserId`. Never throws: the Manage Portal
 * page must still render (and still offer "Disable portal access") when Clerk
 * is unreachable or the user was deleted on Clerk's side. A null return means
 * "we could not read the account", not "there is no account".
 */
export async function loadPortalAccount(
  clerkUserId: string,
): Promise<PortalAccount | null> {
  try {
    const cc = await clerkClient();
    return toPortalAccount(await cc.users.getUser(clerkUserId));
  } catch (err) {
    console.error(
      "[portal-account] Clerk getUser failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
