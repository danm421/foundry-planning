import { isCashFund } from "@/lib/investments/classification/rules";
import type { ExtractedHolding } from "./types";

/** A sweep or credit balance named for its line rather than "Cash" (Schwab's "Bank Sweep"). */
const CASH_LINE = /\b(?:bank|cash|deposit)\s+sweep\b|\bfree\s+credit\b/i;

/**
 * Cash, a bank sweep or a free credit balance: named "Cash" by the prompt's
 * convention, or named for its line ("Bank Sweep") when the model takes the
 * table's Type column as the name. A money-market fund is never cash here —
 * it keeps its own ticker.
 */
export function isCashHolding(h: ExtractedHolding): boolean {
  if ((h.name ?? "").trim().toLowerCase() === "cash") return true;
  return CASH_LINE.test(`${h.name ?? ""} ${h.ticker ?? ""}`) && !isCashFund(h.ticker, h.name, undefined);
}

/**
 * Cash is never a security, and is $1 a unit. A ticker on it is the model
 * echoing the name ("Cash" → upper-cased to CASH, which is a real stock,
 * Pathward Financial, so commit live-priced tens of thousands of dollars of
 * cash at about $74 a "share") or the description ("CHARLES SCHWAB BANK,X,Z").
 * A position named "Cash" keeps its name, so a real holding of the CASH stock
 * (named for its issuer) is untouched.
 */
function holdCashAsCash(out: ExtractedHolding): void {
  if (!isCashHolding(out)) return;
  delete out.ticker;
  out.price = 1;
}

/**
 * Hold a position READ FROM A STATEMENT to what a statement can say: cash as
 * cash (`holdCashAsCash`) whose quantity is its value, and a cost basis only
 * when it is one. Pure; returns a copy. Statement reads only — an
 * advisor-typed $0 basis (the rebalancer's ad-hoc holdings) is deliberate, and
 * an advisor's edit to a cash line's quantity is theirs, which is why
 * `normalizeExtractedHolding` does neither.
 *
 * - Cash's quantity IS its dollar value: when the two disagree the market
 *   value wins, because a cash table's other column is the period's BEGINNING
 *   balance and that is the one a model mistakes for the quantity.
 * - A cost basis is a positive amount paid. Zero is the prompt's placeholder
 *   and a negative is a gain/(loss) figure read from the wrong column — either
 *   way the statement gave no basis, so none is kept.
 * - A cash line prints no cost basis, so whatever the model put there came
 *   from a balance column (Schwab's cash table prints the period's beginning
 *   balance), and a statement's total cost basis leaves cash out.
 * - A money-market fund priced at $1 has its value as its basis. Any other
 *   figure came from that same balance column, so none is kept. (A fund that
 *   only sounds like one — "cash management" at a floating price — keeps its.)
 */
export function sanitizeExtractedHolding(h: ExtractedHolding): ExtractedHolding {
  const out: ExtractedHolding = { ...h };
  if (out.costBasis != null && !(out.costBasis > 0)) delete out.costBasis;
  if (isCashHolding(out)) {
    delete out.costBasis;
    if (out.marketValue != null) out.shares = out.marketValue;
  }
  if (
    out.costBasis != null &&
    out.marketValue != null &&
    out.price === 1 &&
    isCashFund(out.ticker, out.name, undefined) &&
    Math.abs(out.costBasis - out.marketValue) >= 0.01
  ) {
    delete out.costBasis;
  }
  holdCashAsCash(out);
  return out;
}

/**
 * Fill in the missing one of (shares, price, marketValue) from the other two,
 * holding cash at $1 (`holdCashAsCash`). Never divides by zero. Pure.
 */
export function normalizeExtractedHolding(h: ExtractedHolding): ExtractedHolding {
  const out: ExtractedHolding = { ...h };
  holdCashAsCash(out);

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
  return { sum, total, gap, flagged: isMaterialGap(gap, total) };
}

/** A gap between the positions and the statement's total worth flagging: past BOTH $100 and 1%. */
export function isMaterialGap(gap: number, total: number): boolean {
  return total > 0 && Math.abs(gap) > 100 && Math.abs(gap) / total > 0.01;
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
