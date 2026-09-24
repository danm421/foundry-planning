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
//
// `ownersAt` takes the ACCOUNT, not its id. The projection rebuilds accounts
// mid-flight — a death bequest replaces `owners` in place, and
// `partitionMixedAccount` hands the family pool back under the ORIGINAL id — so
// an id alone cannot say whether the rows this snapshot resolved from are still
// the live ones. Holding the account lets every unresolvable case fall back to
// the rows the caller is actually holding, which is what the call sites read
// before this snapshot existed.

import { giftAwareOwners, type AccountOwner, type AccountWithOwners } from "./ownership";
import type { Account, GiftEvent } from "./types";

export interface OwnershipSnapshot {
  /** Gift-resolved owners for `account` as of `year`. Returns `account.owners`
   *  itself (by reference) whenever no in-window asset gift moves the account,
   *  so the hot path allocates nothing. A year above the horizon resolves to
   *  the last projected year's ownership; a year below it gets the authored
   *  baseline, because gifts predating the plan are already in those rows. */
  ownersAt(account: AccountWithOwners, year: number): AccountOwner[];
}

interface ResolvedAccount {
  /** The exact `owners` array the steps below were resolved FROM. A later read
   *  whose account carries a different array has been rebuilt since this
   *  snapshot was taken, and these steps are stale for it. */
  authored: AccountOwner[];
  /** Ascending by `from`, and non-empty. Ownership is a step function of year:
   *  it changes only in a year a gift lands, so one entry per distinct in-window
   *  gift year is the entire history. */
  steps: Array<{ from: number; owners: AccountOwner[] }>;
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

  // The years worth resolving, per account. Ownership only moves in a year a
  // gift lands, so resolving per PROJECTION year would call `giftAwareOwners`
  // ~40x per account and — for an account whose authored rows already encode
  // the transfer (the ILIT / §2035 shape `canFundGifts` exists for) — print its
  // fallback warning ~40 times for one account.
  //
  // These bounds choose which years to EVALUATE. `giftAwareOwners` remains the
  // only thing that decides which events compose. The one thing they must hold
  // is the invariant the evaluation loop relies on: every year collected here
  // has at least one gift inside `giftAwareOwners`' own window.
  const giftYears = new Map<string, Set<number>>();
  for (const e of giftEvents) {
    if (e.kind !== "asset") continue;
    if (e.year < planStartYear) continue; // already in the authored baseline
    // A gift landing past the horizon never takes effect inside it, and a read
    // above the horizon resolves to the last projected year — so it never
    // takes effect at all. Recording it would let one leak into such a read.
    if (e.year > last) continue;
    // A gift dated before the first projected year still takes effect at that
    // first year — it is in-window for every year the snapshot can be asked for.
    const from = e.year < first ? first : e.year;
    let set = giftYears.get(e.accountId);
    if (!set) giftYears.set(e.accountId, (set = new Set()));
    set.add(from);
  }

  const resolved = new Map<string, ResolvedAccount>();
  for (const account of accounts) {
    const breakpoints = giftYears.get(account.id);
    if (!breakpoints) continue;
    // Review Focus #1: an account with no owner rows has nothing for the
    // overlay to move. Business children carry `owners: []` by design. Left to
    // itself `giftAwareOwners` would reach `canFundGifts`, which reads the
    // shortfall as "the caller is passing owners that ALREADY have the overlay
    // applied" — true of an ILIT policy, flatly wrong for a by-design empty
    // array. Stop before that advice is printed for one.
    if (account.owners.length === 0) continue;

    const steps: ResolvedAccount["steps"] = [];
    for (const from of [...breakpoints].sort((a, b) => a - b)) {
      const owners = giftAwareOwners(account, giftEvents, from, planStartYear);
      // Every breakpoint has a gift in window (see the invariant above), so a
      // composition here always allocates a fresh array. Getting the authored
      // array back by reference therefore means exactly one thing: the
      // `canFundGifts` fallback declined to retitle. That verdict only depends
      // on a gifted total that never shrinks as the year advances, so it holds
      // for every later year too — stop, and let it warn once per account.
      if (owners === account.owners) break;
      steps.push({ from, owners });
    }
    if (steps.length > 0) resolved.set(account.id, { authored: account.owners, steps });
  }

  return {
    ownersAt(account: AccountWithOwners, year: number): AccountOwner[] {
      const entry = resolved.get(account.id);
      if (!entry) return account.owners;
      // Rebuilt since the snapshot was taken (death bequest, family-pool
      // partition, business succession): those rows are authored anew and
      // post-date us, so they win.
      if (entry.authored !== account.owners) return account.owners;
      // Years outside the horizon need no special case. No step is recorded
      // before the first projected year or after the last, so a year below the
      // horizon falls through every step to the authored baseline, and a year
      // above it lands on the newest step still standing at the horizon.
      for (let i = entry.steps.length - 1; i >= 0; i--) {
        if (entry.steps[i].from <= year) return entry.steps[i].owners;
      }
      return account.owners;
    },
  };
}
