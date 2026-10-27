// Pure: which accounts' revocable-trust tag the Solver changed, for Save to
// base. The lever emits account-upserts carrying `revocableTrustName`; the base
// column is `accounts.revocable_trust_id`, so the route needs the net changes
// to resolve names to ids. Blank names read as "no trust".
import type { Account } from "@/engine/types";

const nameOf = (a: Pick<Account, "revocableTrustName">): string | null =>
  a.revocableTrustName?.trim() || null;

/** accountId → trust name to tag into (null = untag). Inserts appear only when
 *  named; updates only when the trimmed name differs from the base account's. */
export function revocableTrustTagChanges(
  baseAccounts: readonly Pick<Account, "id" | "revocableTrustName">[],
  inserts: readonly Pick<Account, "id" | "revocableTrustName">[],
  updates: readonly Pick<Account, "id" | "revocableTrustName">[],
): Map<string, string | null> {
  const changes = new Map<string, string | null>();
  for (const a of inserts) {
    const name = nameOf(a);
    if (name) changes.set(a.id, name);
  }
  const baseById = new Map(baseAccounts.map((a) => [a.id, a]));
  for (const a of updates) {
    const base = baseById.get(a.id);
    const next = nameOf(a);
    if (next !== (base ? nameOf(base) : null)) changes.set(a.id, next);
  }
  return changes;
}
