export const MAX_ACCOUNTS_PER_ADVISOR = 5;

/**
 * Short per-account names for the week view ("foundryplanning", "gmail"): the
 * first label of the email's domain. If two accounts would share one, both fall
 * back to the full address so they stay distinguishable.
 */
export function accountLabels(accounts: Array<{ id: string; email: string }>): Map<string, string> {
  const short = (email: string) => email.slice(email.lastIndexOf("@") + 1).split(".")[0];
  const counts = new Map<string, number>();
  for (const a of accounts) counts.set(short(a.email), (counts.get(short(a.email)) ?? 0) + 1);
  return new Map(
    accounts.map((a) => [a.id, (counts.get(short(a.email)) ?? 0) > 1 ? a.email : short(a.email)]),
  );
}
