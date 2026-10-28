import type { Account, Will, WillBequestRecipient } from "../types";
import { firesAtDeath, recipientHasLapsed } from "./shared";

/** One account's will-passing slice at this death, as the will's gifts see it. */
export interface WillGiftPoolEntry {
  accountId: string;
  category: Account["category"];
  /** The deceased's routed share at death, net of any margin loan (the chain's effectiveAcct.value). */
  value: number;
  /** Fraction of `value` still undisposed after titling + beneficiary designations. */
  undisposed: number;
}

export interface WillGiftShare {
  accountId: string;
  /** Fraction of the pool entry's `value` this recipient takes. */
  fraction: number;
  recipient: WillBequestRecipient;
}

/** Dollar gifts draw from cash and brokerage only; a home or business is
 *  never sold to fill one. */
const ELIGIBLE = new Set<Account["category"]>(["cash", "taxable"]);

/** An account with no more than this fraction left is spent: the chain's own
 *  `undisposed > 1e-9` gate, so float residue never becomes a later gift. */
const SPENT = 1e-9;

/** Pay the will's asset and dollar gifts top to bottom in `sortOrder`, each
 *  taking from whatever is left at its turn. Liability gifts run upstream.
 *
 *  - A percentage gift takes `percentage`% of what's left of its account
 *    (`specific`) or of every pool account (`all_assets`), split across its
 *    recipients by their percentages.
 *  - A dollar gift draws first from its named cash/brokerage account, then —
 *    when its source is the estate or its fallback box is on — from the rest
 *    of the estate's cash and brokerage, pro-rata to what each has left. A
 *    short gift pays what's there, split across recipients by their amounts.
 *  - A lapsed recipient (a spouse with no surviving spouse) is not paid; their
 *    share or amount stays for the gifts below.
 *
 *  Whatever no share claims flows on to the residuary and fallback. */
export function allocateWillGifts(
  pool: WillGiftPoolEntry[],
  will: Will,
  deathOrder: 1 | 2,
  survivorFmId: string | null,
): WillGiftShare[] {
  const byId = new Map(pool.map((e) => [e.accountId, e]));
  const left = new Map(pool.map((e) => [e.accountId, e.undisposed]));
  const shares: WillGiftShare[] = [];

  const remaining = (accountId: string): number => {
    const f = left.get(accountId) ?? 0;
    return f > SPENT ? f : 0;
  };
  const dollarsLeft = (e: WillGiftPoolEntry): number => remaining(e.accountId) * e.value;
  const take = (accountId: string, fraction: number, recipient: WillBequestRecipient) => {
    if (!(fraction > 0)) return;
    left.set(accountId, left.get(accountId)! - fraction);
    shares.push({ accountId, fraction, recipient });
  };

  const gifts = will.bequests
    .filter((b) => (b.kind === "asset" || b.kind === "dollar") && firesAtDeath(b, deathOrder))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const b of gifts) {
    const live = b.recipients.filter((r) => !recipientHasLapsed(r, survivorFmId));

    if (b.kind === "asset") {
      const specific = b.assetMode === "specific" && b.accountId != null ? byId.get(b.accountId) : undefined;
      const targets = b.assetMode === "all_assets" ? pool : specific ? [specific] : [];
      for (const e of targets) {
        // Same operation order as the old 3a/3b steps, so a will with one
        // gift per account produces bit-identical fractions.
        const clause = remaining(e.accountId) * (b.percentage / 100);
        for (const r of live) take(e.accountId, clause * (r.percentage / 100), r);
      }
      continue;
    }

    const want = live.reduce((s, r) => s + (r.amount ?? 0), 0);
    if (!(want > 0)) continue;

    const namedEntry = b.dollarSource === "account" && b.accountId != null ? byId.get(b.accountId) : undefined;
    const named = namedEntry && ELIGIBLE.has(namedEntry.category) ? namedEntry : undefined;
    const spill = b.dollarSource === "estate" || b.fallbackToEstate === true;

    // Every draw is sized before any is taken, so the pro-rata split sees
    // each account's balance at the gift's turn.
    const draws: Array<[WillGiftPoolEntry, number]> = [];
    let owed = want;
    if (named) {
      const d = Math.min(owed, dollarsLeft(named));
      if (d > 0) {
        draws.push([named, d]);
        owed -= d;
      }
    }
    if (spill && owed > 0) {
      const sources = pool.filter((e) => e !== named && ELIGIBLE.has(e.category) && dollarsLeft(e) > 0);
      const avail = sources.reduce((s, e) => s + dollarsLeft(e), 0);
      const paid = Math.min(owed, avail);
      for (const e of sources) draws.push([e, paid * (dollarsLeft(e) / avail)]);
    }

    for (const [e, d] of draws) {
      const fraction = d / e.value;
      for (const r of live) take(e.accountId, fraction * ((r.amount ?? 0) / want), r);
    }
  }

  return shares;
}
