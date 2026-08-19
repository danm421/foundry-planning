// Pure "what looks recurring in this client's history" detection.
// NO @/db, Next, or Plaid imports — unit-tested in plain vitest.
//
// The shape of the problem, per the ask: find charges that land on the same
// date (or near it), for a similar amount, from a similar name. Each of those
// three is a separate stage below — name grouping, amount clustering, cadence —
// and a candidate has to survive all three.
import type { RecurringSuggestionDTO } from "@/lib/portal/contracts";
import {
  matchesRecurring,
  round2,
  type RecurringLike,
} from "@/lib/portal/recurring-matching";

export type { RecurringSuggestionDTO };

export type SuggestionTxn = {
  id: string;
  merchantName: string | null;
  name: string;
  amount: number; // spend-positive
  date: string; // YYYY-MM-DD
  categoryId: string | null;
};

/** Occurrences needed before we will call a rhythm a pattern. */
const MIN_MONTHLY_HITS = 3;
const MIN_ANNUAL_HITS = 2;
/** How stale the newest charge may be before we treat it as cancelled. */
const MONTHLY_STALE_DAYS = 45;
const ANNUAL_STALE_DAYS = 400;
/** Day-of-month spread we will still call "the same date every month". */
const SAME_DAY_SPREAD = 5;
const DEFAULT_LIMIT = 6;

// ---------------------------------------------------------------- date helpers

function utcMs(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}
function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}
function median(ns: number[]): number {
  const s = [...ns].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------- 1. similar name

/** Grouping key only — deliberately lossy. Store numbers, phone numbers and
 *  punctuation vary charge to charge, so they cannot be part of the identity.
 *  Capped at three words so "PUGET SOUND ENERGY BILLPAY" and "…PMT 0091" land
 *  together while "AMAZON MKTPL" and "AMAZON PRIME" stay apart. */
export function normalizeMerchantKey(txn: { merchantName: string | null; name: string }): string {
  const tokens = (txn.merchantName ?? txn.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0 && !/\d/.test(t));
  // A trailing state code ("… SEATTLE WA") comes and goes between charges, so
  // it cannot be part of the identity. Only ever stripped down to two words —
  // a short name that IS the merchant ("AT&T" -> "at t") has to survive.
  while (tokens.length > 2 && tokens[tokens.length - 1].length <= 2) tokens.pop();
  return tokens.slice(0, 3).join(" ");
}

/** The text a suggestion is named and matched by. Plaid's cleaned merchant name
 *  is the good one almost always — but it sometimes cleans a name down to a
 *  fragment ("SparkFun" arrives as merchant "FUN"), and a two- or three-letter
 *  "contains" rule would sweep unrelated spend into the client's budget. When
 *  the fragment sits inside the raw descriptor, the descriptor is the safer name.
 */
export function displayNameFor(txn: { merchantName: string | null; name: string }): string {
  const merchant = txn.merchantName?.trim();
  if (!merchant) return txn.name;
  if (merchant.length < 4 && txn.name.toLowerCase().includes(merchant.toLowerCase())) return txn.name;
  return merchant;
}

/** A literal pattern that every one of these descriptors contains. Returns the
 *  shared name when they all agree, otherwise their common opening — trimmed
 *  back to the last letter so it never ends on half a store number. */
export function commonPattern(displays: string[]): string | null {
  if (displays.length === 0) return null;
  const unique = [...new Set(displays.map((d) => d.trim()))];
  if (unique.length === 1) return unique[0] || null;

  const lower = unique.map((d) => d.toLowerCase());
  let end = 0;
  const shortest = Math.min(...lower.map((d) => d.length));
  while (end < shortest && lower.every((d) => d[end] === lower[0][end])) end += 1;

  const prefix = unique[0].slice(0, end).replace(/[^A-Za-z]+$/, "");
  return prefix.length >= 3 ? prefix : null;
}

// ---------------------------------------------------------------- 2. similar amount

/** Splits a merchant's charges into bands of similar size, so a $17.99 sub and
 *  a $6.99 sub from the same merchant become two suggestions rather than one
 *  meaningless $7–$18 rule. A cluster breaks on a large step OR once it has
 *  stretched past 2.5x its floor — the second guard stops a long chain of small
 *  steps from quietly swallowing the whole range. */
export function clusterByAmount<T>(items: T[], amountOf: (t: T) => number): T[][] {
  const sorted = [...items].sort((a, b) => amountOf(a) - amountOf(b));
  const clusters: T[][] = [];
  let current: T[] = [];
  let floor = 0;
  let prev = 0;
  for (const item of sorted) {
    const amount = amountOf(item);
    const stepTooBig = amount - prev > Math.max(5, prev * 0.25);
    const spreadTooWide = amount > floor * 2.5;
    if (current.length === 0 || (!stepTooBig && !spreadTooWide)) {
      if (current.length === 0) floor = amount;
      current.push(item);
    } else {
      clusters.push(current);
      current = [item];
      floor = amount;
    }
    prev = amount;
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

// ---------------------------------------------------------------- 3. same date

export type Cadence = {
  cadence: "monthly" | "annually";
  dueDay: number | null;
  dueMonth: number | null;
};

/** Reads a rhythm off the dates, or nothing. The median gap is what decides —
 *  it shrugs off a skipped month that would wreck an average. Weekly and
 *  biweekly rhythms are deliberately rejected: the recurring schema only offers
 *  monthly and annually, so suggesting one would misstate the budget. */
export function detectCadence(dates: string[]): Cadence | null {
  const days = [...new Set(dates)].sort();
  if (days.length < MIN_ANNUAL_HITS) return null;

  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]));
  const gap = median(gaps);
  const dayOfMonth = days.map((d) => Number(d.slice(8, 10)));

  if (gap >= 23 && gap <= 38 && days.length >= MIN_MONTHLY_HITS) {
    const spread = Math.max(...dayOfMonth) - Math.min(...dayOfMonth);
    return {
      cadence: "monthly",
      dueDay: spread <= SAME_DAY_SPREAD ? Math.round(median(dayOfMonth)) : null,
      dueMonth: null,
    };
  }
  if (gap >= 300 && gap <= 430) {
    return {
      cadence: "annually",
      dueDay: Math.round(median(dayOfMonth)),
      dueMonth: Number(days[days.length - 1].slice(5, 7)),
    };
  }
  return null;
}

// ---------------------------------------------------------------- assembly

function mostCommonCategory(txns: SuggestionTxn[]): string | null {
  const counts = new Map<string, number>();
  for (const t of txns) {
    if (!t.categoryId) continue;
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[0]?.[0] ?? null;
}

/** Higher is more worth showing. Occurrence count carries most of it; a charge
 *  that lands on the same day every month and holds the same amount is the
 *  clearest kind of recurring, so both earn a bonus. */
function score(s: { occurrences: number; dueDay: number | null; cadence: string }, amounts: number[]): number {
  const mid = median(amounts);
  const spread = Math.max(...amounts) - Math.min(...amounts);
  const tightness = mid > 0 ? 6 * (1 - Math.min(1, spread / mid)) : 0;
  return (
    Math.min(s.occurrences, 12) * 2 +
    (s.dueDay != null ? 6 : 0) +
    tightness +
    (s.cadence === "monthly" ? 2 : 0)
  );
}

export function detectRecurringSuggestions(input: {
  transactions: SuggestionTxn[];
  existing: RecurringLike[];
  categories: { id: string; name: string; color: string | null; icon: string | null }[];
  today: string; // YYYY-MM-DD
  limit?: number;
}): RecurringSuggestionDTO[] {
  const { transactions, existing, categories, today, limit = DEFAULT_LIMIT } = input;
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Staleness is judged against the newest charge we hold, not the calendar. A
  // client whose bank sync is two months behind still has live subscriptions —
  // measuring from today would blank their whole list. A charge that stopped
  // while the client's other spending carried on is still caught, because the
  // rest of the history moved on without it.
  const newest = transactions.reduce((m, t) => (t.date > m ? t.date : m), "");
  const asOf = newest && newest < today ? newest : today;

  const byName = new Map<string, SuggestionTxn[]>();
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const key = normalizeMerchantKey(t);
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(t);
    byName.set(key, list);
  }

  const scored: { suggestion: RecurringSuggestionDTO; rank: number }[] = [];

  for (const [key, group] of byName) {
    for (const cluster of clusterByAmount(group, (t) => t.amount)) {
      if (cluster.length < MIN_ANNUAL_HITS) continue;

      const pattern = commonPattern(cluster.map(displayNameFor));
      if (!pattern) continue;

      // The promise of a suggestion is that accepting it claims these charges.
      // That holds because commonPattern only ever returns a prefix of the very
      // descriptors it was given, so a "contains" match on them cannot miss —
      // the Puget Sound case in the tests asserts it end to end.
      const members = cluster;
      const cadence = detectCadence(members.map((t) => t.date));
      if (!cadence) continue;

      const amounts = members.map((t) => t.amount);
      const amountMin = round2(Math.min(...amounts) * 0.8);
      const amountMax = round2(Math.max(...amounts) * 1.25);

      const dates = [...members].sort((a, b) => (a.date < b.date ? 1 : -1));
      const lastDate = dates[0].date;
      const staleAfter = cadence.cadence === "monthly" ? MONTHLY_STALE_DAYS : ANNUAL_STALE_DAYS;
      if (daysBetween(lastDate, asOf) > staleAfter) continue;

      // Anything an existing rule already claims is not a suggestion.
      const covered = existing.some((r) => members.some((t) => matchesRecurring(r, t)));
      if (covered) continue;

      const categoryId = mostCommonCategory(members);
      const cat = categoryId ? catById.get(categoryId) : undefined;
      const predicted = round2(median(amounts));

      const suggestion: RecurringSuggestionDTO = {
        key: `${cadence.cadence}:${key}:${Math.round(predicted)}`,
        name: pattern,
        matchType: "contains",
        pattern,
        amountMin,
        amountMax,
        predicted,
        cadence: cadence.cadence,
        dueDay: cadence.dueDay,
        dueMonth: cadence.dueMonth,
        occurrences: members.length,
        lastDate,
        categoryId,
        categoryName: cat?.name ?? null,
        categoryColor: cat?.color ?? null,
        categoryIcon: cat?.icon ?? null,
        sample: dates.slice(0, 3).map((t) => ({ id: t.id, date: t.date, amount: round2(t.amount) })),
      };
      scored.push({
        suggestion,
        rank: score({ occurrences: members.length, dueDay: cadence.dueDay, cadence: cadence.cadence }, amounts),
      });
    }
  }

  return scored
    .sort((a, b) => b.rank - a.rank || b.suggestion.predicted - a.suggestion.predicted)
    .slice(0, limit)
    .map((s) => s.suggestion);
}
