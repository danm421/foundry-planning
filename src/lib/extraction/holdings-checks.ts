import { isCashHolding, isMaterialGap, sanitizeExtractedHolding } from "./normalize-holdings";
import type { ExtractedAccount, ExtractedHolding } from "./types";

/** How far a row's market value − cost basis may miss its printed gain on rounding alone. */
const ROW_GAP_PCT = 0.005;
const ROW_GAP_ABS = 1;
/** A warning names this many positions, then counts the rest. */
const MAX_NAMED = 8;
/** A position row prints its market value within this many words of its ticker. */
const ROW_WORDS = 40;

/**
 * Check one account's positions against the statement they were read from,
 * once, after the read (and any continuation passes) — before the advisor
 * reviews them.
 *
 * First the cost basis and gain are READ FROM THE PRINTED ROW wherever the
 * row can be found and its table prints Market Value, Cost Basis and
 * Unrealized Gain/(Loss) side by side (Schwab, Fidelity, Pershing). The
 * model finds rows reliably — ticker and market value — but maps a dense
 * row's columns unreliably: re-reading one Schwab statement three times gave
 * 9 to 14 of 37 positions their gain as the basis, or a misread digit. The
 * printed figure is the authority, so it replaces the model's (and fills a
 * market value the model returned as 0) and the advisor is told which
 * positions' basis changed.
 *
 * Then each position is sanitized (`sanitizeExtractedHolding`) and a warning
 * is raised per kind of figure that still doesn't hold up:
 *
 * 1. a NEGATIVE cost basis — a gain/(loss) read from the wrong column; the
 *    sanitize leaves it blank, this says why;
 * 2. the positions' cost basis not adding up to the statement's own total
 *    (`account.basis`) — the net for layouts the row reading can't parse;
 * 3. a row whose market value − cost basis misses its printed gain/(loss);
 * 4. a market value or cost basis printed nowhere in the document — a
 *    misread digit (a cash balance that came back $80 off).
 *
 * Nothing is ever derived from the other figures — any of them could be the
 * misread one. Pure.
 */
export function reviewStatementHoldings(
  account: ExtractedAccount,
  documentText: string,
): { account: ExtractedAccount; warnings: string[] } {
  if (!account.holdings?.length) return { account, warnings: [] };
  const who = `"${account.name}"`;
  const warnings: string[] = [];

  const corrected: string[] = [];
  const read = account.holdings.map((h) => {
    const row = printedRow(h, documentText);
    if (!row) return h;
    // Only a basis the model gave and the row contradicts is news; one it left
    // out is just filled in, and the gain is read only to cross-check it.
    if (h.costBasis != null && basisCents(row.basis) !== basisCents(h.costBasis)) corrected.push(label(h));
    return { ...h, marketValue: row.marketValue, costBasis: row.basis, unrealizedGain: row.gain };
  });
  if (corrected.length > 0) {
    warnings.push(
      `${who}: the cost basis of ${named(corrected)} was read from the wrong column and was corrected to the statement's Cost Basis column. Spot-check them.`,
    );
  }

  const negative = read.filter((h) => h.costBasis != null && h.costBasis < 0);
  const holdings = read.map(sanitizeExtractedHolding);

  if (negative.length > 0) {
    warnings.push(
      `${who}: ${named(negative.map(label))} came back with a negative cost basis. A basis can't be negative — that figure is a gain or loss — so it was left blank. Check the cost basis column was read correctly.`,
    );
  }

  const withBasis = holdings.filter((h) => h.costBasis != null);
  const stated = account.basis;
  if (stated != null && withBasis.length > 0) {
    const sum = withBasis.reduce((s, h) => s + h.costBasis!, 0);
    if (isMaterialGap(sum - stated, stated)) {
      warnings.push(
        `${who}: the positions' cost basis adds up to ${usd(sum)}, but the statement's total cost basis is ${usd(stated)}. Check each position's cost basis before importing — a gain/(loss) or balance column may have been read as the basis.`,
      );
    }
  }

  const disagree = holdings.filter(
    (h) =>
      h.marketValue != null &&
      h.costBasis != null &&
      h.unrealizedGain != null &&
      Math.abs(h.marketValue - h.costBasis - h.unrealizedGain) >
        Math.max(ROW_GAP_ABS, ROW_GAP_PCT * Math.abs(h.marketValue)),
  );
  if (disagree.length > 0) {
    warnings.push(
      `${who}: market value minus cost basis doesn't match the statement's unrealized gain/(loss) for ${named(disagree.map(label))}. Check those positions.`,
    );
  }

  const printed = printedFigures(documentText);
  if (printed.size > 0) {
    const unprinted: string[] = [];
    for (const h of holdings) {
      const value = h.marketValue ?? (isCashHolding(h) ? h.shares : undefined);
      if (value != null && !printed.has(cents(value))) unprinted.push(`${label(h)} value ${usd(value)}`);
      if (h.costBasis != null && !printed.has(cents(h.costBasis))) unprinted.push(`${label(h)} cost basis ${usd(h.costBasis)}`);
    }
    if (unprinted.length > 0) {
      warnings.push(`${who}: these figures don't appear anywhere on the statement — check them: ${named(unprinted)}.`);
    }
  }

  return { account: { ...account, holdings }, warnings };
}

/** A dollar amount as a statement prints one: cents, or a comma-grouped whole number. */
const MONEY = /^\(?-?\$?(?:(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}|\d{1,3}(?:,\d{3})+)\)?$/;
/** A cell that prints no figure. */
const NO_FIGURE = /^(?:N\/A|--|-)$/i;
/** A footnote marker between cells (Schwab's "i"). */
const FOOTNOTE = /^[a-z]$/i;
/** The table's columns run Market Value, Cost Basis, Unrealized Gain — in that order. */
const BASIS_HEADER = /^Market\s+Value\s*(?:\(\$\))?\s+(?:Total\s+|Adjusted\s+)?Cost(?:\s+Basis)?\s*(?:\(\$\))?\s+Unrealized\s+Gain/i;
/** A table's closing total line ("Total Equities $1,234,567.89") — not a fund named "TOTAL STOCK MKT". */
const TABLE_TOTAL = /\bTotal\b[^$\d]{0,80}\$\d/i;

/**
 * The market value, cost basis and gain a position's own row prints, or
 * undefined when the row can't be found or its table doesn't print them in
 * that order. A row is the ticker, then (within `ROW_WORDS`) its market
 * value, then the next two cells; a cell printed "N/A" is none. Requiring
 * the market value to be followed by two cells is what passes over a summary
 * line that names the ticker and its value ("NVDA NVIDIA CORP 199,570.00
 * 5%"). The row is found by the model's market value or, when it gave none
 * (a continuation pass can return 0), by shares × price, which the row prints
 * to the cent.
 */
function printedRow(
  h: ExtractedHolding,
  text: string,
): { marketValue: number; basis?: number; gain?: number } | undefined {
  const ticker = h.ticker?.trim();
  const value =
    h.marketValue != null && h.marketValue > 0
      ? h.marketValue
      : h.shares != null && h.price != null
        ? h.shares * h.price
        : undefined;
  if (!ticker || value == null) return undefined;
  const target = cents(value);
  const at = new RegExp(`(?<=^|\\s)${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s)`, "g");
  for (const m of text.matchAll(at)) {
    const words = text.slice(m.index).split(/\s+/, ROW_WORDS + 3).slice(1);
    const k = words.findIndex((w) => MONEY.test(w) && cents(money(w)) === target);
    if (k < 0) continue;
    const cells: (number | null)[] = [];
    for (const w of words.slice(k + 1)) {
      if (FOOTNOTE.test(w)) continue;
      if (MONEY.test(w)) cells.push(money(w));
      else if (NO_FIGURE.test(w)) cells.push(null);
      else break;
      if (cells.length === 2) break;
    }
    if (cells.length < 2) continue;
    if (!underBasisHeader(text, m.index)) continue;
    const [basis, gain] = cells;
    return { marketValue: money(words[k]), basis: basis !== null && basis > 0 ? basis : undefined, gain: gain ?? undefined };
  }
  return undefined;
}

/**
 * The last "Market Value" before the row opens a Market Value, Cost Basis,
 * Unrealized Gain header, and that table hasn't closed on its total line
 * before the row — a cash table printed after it has no Market Value header
 * of its own.
 */
function underBasisHeader(text: string, rowAt: number): boolean {
  let last = -1;
  for (const m of text.slice(0, rowAt).matchAll(/Market\s+Value/gi)) last = m.index;
  const header = last < 0 ? null : text.slice(last).match(BASIS_HEADER);
  return header != null && !TABLE_TOTAL.test(text.slice(last + header[0].length, rowAt));
}

function money(w: string): number {
  const n = Number(w.replace(/[$,()]/g, ""));
  return w.startsWith("(") ? -Math.abs(n) : n;
}

/**
 * Every amount the document prints, as whole cents. Amounts print with at most
 * two decimals, so a match stops there: a text layer that runs two columns
 * together ("38,480.001,234.56") still yields both, and a four-decimal
 * quantity or price yields its rounded self plus a stray fragment, which is
 * harmless in a set that is only ever asked "was this printed?".
 */
function printedFigures(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g)) {
    out.add(cents(Number(m[0].replace(/,/g, ""))));
  }
  return out;
}

const cents = (n: number) => Math.round(Math.abs(n) * 100);

/** A basis to compare, in cents; a zero or negative one is none (see the sanitize). */
const basisCents = (n: number | undefined) => (n != null && n > 0 ? cents(n) : null);

const label = (h: ExtractedHolding) => h.ticker?.trim() || h.name?.trim() || "a position";

function named(items: string[]): string {
  if (items.length <= MAX_NAMED) return items.join(", ");
  return `${items.slice(0, MAX_NAMED).join(", ")} and ${items.length - MAX_NAMED} more`;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
