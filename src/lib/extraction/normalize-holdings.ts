import type { ExtractedHolding } from "./types";

/**
 * Fill in the missing one of (shares, price, marketValue) from the other two,
 * and default cash to a $1 price. Never divides by zero. Pure.
 */
export function normalizeExtractedHolding(h: ExtractedHolding): ExtractedHolding {
  const out: ExtractedHolding = { ...h };
  const isCash = (out.name ?? "").trim().toLowerCase() === "cash";
  if (isCash && out.price == null) out.price = 1;

  const { shares, price, marketValue } = out;
  if (marketValue == null && shares != null && price != null) {
    out.marketValue = shares * price;
  } else if (price == null && marketValue != null && shares != null && shares !== 0) {
    out.price = marketValue / shares;
  } else if (shares == null && marketValue != null && price != null && price !== 0) {
    out.shares = marketValue / price;
  }
  return out;
}

/** Best-effort market value of one holding (statement-era; no live pricing). */
export function holdingMarketValue(h: ExtractedHolding): number {
  return normalizeExtractedHolding(h).marketValue ?? 0;
}

/**
 * Review-time reconciliation of the holdings sum against the account's stated
 * total. Flags only when the gap is material in BOTH relative (>1%) and
 * absolute (>$100) terms, so we don't nag on rounding (big account) or trivial
 * dollars (tiny account).
 */
export function holdingsReconciliation(
  holdings: ExtractedHolding[],
  accountValue: number | undefined,
): { sum: number; total: number; gap: number; flagged: boolean } {
  const sum = holdings.reduce((s, h) => s + holdingMarketValue(h), 0);
  const total = accountValue ?? 0;
  const gap = sum - total;
  const absGap = Math.abs(gap);
  const flagged = total > 0 && absGap > 100 && absGap / total > 0.01;
  return { sum, total, gap, flagged };
}

/**
 * The holdings materially *undershoot* the stated value: a flagged reconciliation
 * gap in the negative (holdings sum < stated) direction. The single home for the
 * "incomplete extraction" predicate shared by extraction-time completion and the
 * commit-time guardrail. Takes a reconciliation result so callers reconcile once.
 */
export function materiallyUndershoots(recon: { flagged: boolean; gap: number }): boolean {
  return recon.flagged && recon.gap < 0;
}

/**
 * Identity of one position: its ticker, or its normalized description when
 * untickered. Two untickered positions with byte-identical descriptions
 * collapse to the same key — a deliberate trade-off (see the dedupe note on
 * `holdings-completion.ts`'s continuation loop).
 *
 * Exported because `mergeAcrossFiles` mints `__holdingId` from it. The
 * continuation loop and the review table MUST agree about whether two rows
 * are the same position; two independent notions of that is how a recovered
 * position ends up with a second id.
 *
 * HERE, in a module whose only import is `./types`, rather than beside that
 * continuation loop — `holdings-completion.ts` opens by importing
 * `azure-client.ts` and so the `openai` SDK, and every consumer of this
 * five-line string helper was paying for that in its module graph. The
 * `/match` route reaches it through `merge-across-files.ts` and makes no
 * Azure call at all.
 */
export function holdingKey(h: ExtractedHolding): string {
  const t = h.ticker?.trim().toUpperCase();
  if (t) return `t:${t}`;
  return `n:${(h.name ?? "").trim().toUpperCase().replace(/\s+/g, " ")}`;
}
