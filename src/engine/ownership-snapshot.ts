// Per-year ownership resolution for the projection.
//
// THE BUG THIS DELETES: "a year-invariant owner map feeding a per-year dollar
// computation". Several projection sites iterated `acct.owners` — the authored,
// pre-gift baseline — inside a per-year dollar loop. An account gifted into a
// trust mid-horizon has no authored entity row, so those sites saw a 0% entity
// share while the balance sheet, reading through `ownersForYear`, saw the trust
// holding it. Same year, two answers.
//
// Rather than thread gift-awareness into each site, the projection builds ONE
// snapshot and every site asks it. Adding a new per-year ownership consumer is
// then a lookup, not a new chance to reintroduce the bug.

import { ownersForYear, type AccountOwner } from "./ownership";
import type { Account, GiftEvent } from "./types";

export interface OwnershipSnapshot {
  /** Gift-resolved owners for `accountId` as of `year`. Returns the authored
   *  array (by reference) when no asset gift in the window touches the account,
   *  so the hot path allocates nothing. Years outside the projection clamp to
   *  the nearest resolved year. */
  ownersAt(accountId: string, year: number): AccountOwner[];
}

export function buildOwnershipSnapshot(
  accounts: Account[],
  giftEvents: GiftEvent[],
  years: number[],
  planStartYear: number,
): OwnershipSnapshot {
  const sortedYears = [...years].sort((a, b) => a - b);
  const first = sortedYears[0] ?? planStartYear;
  const last = sortedYears[sortedYears.length - 1] ?? planStartYear;

  // Which accounts a gift can actually move. Everything else keeps its authored
  // array for every year — no clone, no resolver call.
  const gifted = new Set<string>();
  for (const e of giftEvents) {
    if (e.kind !== "asset") continue;
    if (e.year < planStartYear) continue; // already in the authored baseline
    gifted.add(e.accountId);
  }

  const authored = new Map<string, AccountOwner[]>();
  for (const a of accounts) authored.set(a.id, a.owners ?? []);

  // accountId → year → resolved owners. Only gifted accounts get entries.
  const resolved = new Map<string, Map<number, AccountOwner[]>>();
  for (const account of accounts) {
    if (!gifted.has(account.id)) continue;
    // An account with NO owner rows cannot host the overlay: `ownersForYear`
    // validates sum-to-1 and an empty array sums to 0. Business children carry
    // no account_owners rows BY DESIGN, so this is the common case, not an edge
    // case — resolving them would throw and take the whole projection down.
    // This check must stay AFTER the gifted check: a gift may name such an
    // account, and membership in `gifted` is exactly what would route it into
    // the throwing path.
    if ((account.owners?.length ?? 0) === 0) continue;
    const byYear = new Map<number, AccountOwner[]>();
    for (const y of sortedYears) {
      byYear.set(y, ownersForYear(account, giftEvents, y, planStartYear));
    }
    resolved.set(account.id, byYear);
  }

  return {
    ownersAt(accountId: string, year: number): AccountOwner[] {
      const byYear = resolved.get(accountId);
      if (!byYear) return authored.get(accountId) ?? [];
      const clamped = year < first ? first : year > last ? last : year;
      return byYear.get(clamped) ?? authored.get(accountId) ?? [];
    },
  };
}
