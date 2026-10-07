// Plain-words pieces the suggestion reasons share, so a figure reads the same
// way on every card: "$1.8M", "up $212k", "2040–2054", "24%".
//
// Imported by the client panel through the rule tables: TYPE imports only from
// the facts modules.
import { compactCurrency, percentLabel, signed as signedWith } from "@/lib/presentations/format";
import type { ProjectedFacts } from "./plan-facts";

export const money = compactCurrency;
export const rate = percentLabel;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function yearsAway(n: number): string {
  return n === 1 ? "a year away" : `${n} years away`;
}

/** "up $212k" / "down $212k". */
export function upDown(delta: number): string {
  return `${delta >= 0 ? "up" : "down"} ${money(Math.abs(delta))}`;
}

/** "+$240k" / "−$240k", and a bare "$0" for a change that rounds to nothing. */
export const signed = (delta: number) => signedWith(delta, money);

/** "a", "a and b", "a, b and c". */
export function listPhrase(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** " in 2030" or ", 2040–2054" — the tail of "converts $X to Roth…". */
export function conversionSpan(p: ProjectedFacts): string {
  return p.rothFirstYear === p.rothLastYear ? ` in ${p.rothFirstYear}` : `, ${p.rothFirstYear}–${p.rothLastYear}`;
}

/** The Tax Bracket page's own story for a plan that converts. */
export function conversionBracketReason(p: ProjectedFacts): string {
  if (p.conversionTopRate == null) return "How much bracket room each conversion year uses.";
  const fill =
    p.conversionEdgeYears > 0
      ? `, filling it to within $10k in ${p.conversionEdgeYears} of ${p.conversionYears} years`
      : "";
  return `The conversions reach the ${rate(p.conversionTopRate)} bracket${fill} — this shows the room left each year.`;
}

/** How the ending portfolio, or the year money runs out, moved against Base Case. */
export function portfolioDelta(p: ProjectedFacts, b: ProjectedFacts): string {
  if (p.depletionYear !== b.depletionYear) {
    return p.depletionYear == null
      ? `the money now lasts the whole plan (Base Case runs out in ${b.depletionYear})`
      : `the portfolio now runs out in ${p.depletionYear} (Base Case: ${b.depletionYear ?? "never"})`;
  }
  const delta = p.endingPortfolio - b.endingPortfolio;
  return Math.abs(delta) < 1_000
    ? "the same ending portfolio as Base Case"
    : `ending portfolio ${upDown(delta)} against Base Case`;
}
