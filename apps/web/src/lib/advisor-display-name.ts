// Plan 2: simplest path — return the Clerk user id as the display name.
// Future work: fetch Clerk user's full_name via Clerk client when needed.
export async function resolveAdvisorDisplayName(clerkUserId: string): Promise<string> {
  return clerkUserId;
}
