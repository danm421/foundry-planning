// src/lib/fact-finder/placement/map/vesting.ts
/**
 * A grant's free-text "Vesting schedule" → its vesting rows (dated tranches),
 * or why it can't be read. Two forms: each vest date with its shares, or an
 * even schedule ("25% a year over 4 years"). Anything else is refused, never
 * guessed — a grant saves only with tranches that add up to its shares. Pure.
 */
import { parseDate } from "../../normalize";

const UNREAD =
  'Vesting schedule: list each vest date and shares ("3/1/2027: 250; 3/1/2028: 250") or say "25% a year over 4 years from 3/1/2026".';
/** An even schedule with no start of its own counts from the grant date, and there is none. */
export const NEEDS_START = 'Add the Grant date, or say when vesting starts ("over 4 years from 3/1/2026").';
/** More vest dates than this is a typo ("monthly over 2000 years"), not a schedule. */
const MAX_TRANCHES = 240;

const DATE = String.raw`\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`;
const SHARES = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
/** "3/1/2027: 250" or "250 shares on 3/1/2027". */
const PAIR = new RegExp(
  String.raw`(${DATE})\s*[:=–-]\s*(${SHARES})(?:\s*shares?)?|(${SHARES})(?:\s*shares?)?\s+(?:on|at)\s+(${DATE})`,
  "gi",
);
/** What may sit between the pairs. */
const FILLER = /^(?:[\s,;.&]|\band\b|\bthen\b|\bvests?\b|\bvesting\b)*$/i;
/** "25% a year over 4 years from 3/1/2026", "vests evenly over 4 years", "quarterly over 3 years". */
const EVEN = new RegExp(
  String.raw`^(?:vests?|vesting)?\s*(?:(\d+(?:\.\d+)?)\s*%\s*)?(?:evenly|equally|ratably)?\s*` +
    String.raw`(?:(?:a|per|each|every)\s+(year|quarter|month)|(annually|yearly|quarterly|monthly))?\s*` +
    String.raw`(?:over\s+(\d+)\s+(years?|months?))?\s*` +
    String.raw`(?:,?\s*(?:from|starting|beginning)(?:\s+on)?\s+(${DATE}))?\s*\.?$`,
  "i",
);
const PERIOD_MONTHS: Record<string, number> = { year: 12, annually: 12, yearly: 12, quarter: 3, quarterly: 3, month: 1, monthly: 1 };

type Tranche = { vestDate: string; shares: number };
type Result = { ok: true; tranches: Tranche[] } | { ok: false; reason: string };

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const shown = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** An ISO date `months` later, kept inside its month (Jan 31 + 1 month → Feb 28). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datedPairs(text: string, sharesGranted: number | null): Result | null {
  const tranches: Tranche[] = [];
  for (const m of text.matchAll(PAIR)) {
    const vestDate = parseDate(m[1] ?? m[4]);
    if (!vestDate) return { ok: false, reason: UNREAD };
    tranches.push({ vestDate, shares: Number((m[2] ?? m[3]).replace(/,/g, "")) });
  }
  if (tranches.length === 0 || !FILLER.test(text.replace(PAIR, " "))) return null;
  const total = tranches.reduce((sum, t) => sum + t.shares, 0);
  if (sharesGranted !== null && Math.abs(total - sharesGranted) > 1e-6) {
    return { ok: false, reason: `Vesting shares add up to ${shown(total)}, not ${shown(sharesGranted)}.` };
  }
  return { ok: true, tranches: tranches.sort((a, b) => a.vestDate.localeCompare(b.vestDate)) };
}

function even(text: string, grant: { grantDate: string | null; sharesGranted: number | null }): Result {
  const m = EVEN.exec(text);
  if (!m) return { ok: false, reason: UNREAD };
  const [, percentText, periodWord, periodAdverb, overText, overUnit, fromText] = m;
  const period = PERIOD_MONTHS[(periodWord ?? periodAdverb ?? "year").toLowerCase()];
  const percent = percentText ? Number(percentText) : null;
  let count: number;
  if (overText) {
    count = (Number(overText) * (overUnit.toLowerCase().startsWith("year") ? 12 : 1)) / period;
    if (percent !== null && Math.abs(percent * count - 100) > 1) return { ok: false, reason: UNREAD };
  } else if (percent) {
    count = Math.round(100 / percent);
    if (Math.abs(100 / percent - count) > 0.01) return { ok: false, reason: UNREAD };
  } else {
    return { ok: false, reason: UNREAD };
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_TRANCHES) return { ok: false, reason: UNREAD };
  const start = fromText ? parseDate(fromText) : grant.grantDate;
  if (fromText && !start) return { ok: false, reason: UNREAD };
  const shares = grant.sharesGranted;
  if (shares === null) return { ok: false, reason: "Add Shares granted to spread the vesting." };
  if (!start) return { ok: false, reason: NEEDS_START };
  const each = round6(shares / count);
  const tranches = Array.from({ length: count }, (_, i) => ({
    vestDate: addMonths(start, (i + 1) * period),
    shares: i === count - 1 ? round6(shares - each * (count - 1)) : each,
  }));
  return { ok: true, tranches };
}

export function parseVestingSchedule(
  text: string,
  grant: { grantDate: string | null; sharesGranted: number | null },
): { ok: true; tranches: { vestDate: string; shares: number }[] } | { ok: false; reason: string } {
  // One space between words: EVEN's run of `\s*`s backtracks without end over a long whitespace run.
  const value = text.trim().replace(/\s+/g, " ");
  return datedPairs(value, grant.sharesGranted) ?? even(value, grant);
}
