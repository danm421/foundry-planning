import type { ClerkEvent } from "./handler";

/**
 * Dispatcher for Clerk webhook events beyond organization.created.
 * Returns null when the event isn't a known membership/user event so the
 * upstream handler can fall through to the generic "ignored" 200.
 *
 * Each event type gets its own handler in subsequent tasks.
 */
export async function dispatchClerkMembership(
  _evt: ClerkEvent,
): Promise<Response | null> {
  return null;
}
