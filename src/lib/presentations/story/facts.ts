// The single place a client-facing figure becomes a string. The model is
// handed `display` values and is forbidden from formatting anything itself,
// so rounding rules cannot drift between two chapters of the same report.
import { fmtUsdCompact } from "@/lib/presentations/pages/retirement-comparison/format";

export interface Fact {
  /** Stable dotted id, e.g. "outcome.confidence.proposed". */
  id: string;
  /** Human label shown to the advisor in the review panel. */
  label: string;
  /** Pre-formatted, client-ready string. The only form the model ever sees. */
  display: string;
  /**
   * The number behind `display`, or null when the pack is only QUOTING a string
   * another module formatted (see `quotedFact`). `raw` exists for the rare
   * narrative that compares two figures rather than printing one, so "no number
   * available" and "compare on `display` only" are the same statement.
   */
  raw: number | null;
}

export function moneyFact(id: string, label: string, raw: number): Fact {
  return { id, label, display: fmtUsdCompact(raw), raw };
}

/** `raw` is a fraction: 0.91 → "91%". At most one decimal, no trailing ".0". */
export function pctFact(id: string, label: string, raw: number): Fact {
  const pct = raw * 100;
  const display = `${Number.isInteger(pct) ? pct : Number(pct.toFixed(1))}%`;
  return { id, label, display, raw };
}

export function yearFact(id: string, label: string, raw: number): Fact {
  return { id, label, display: String(Math.round(raw)), raw };
}

/**
 * A figure this document did not format, admitted to the pack exactly as it was
 * written elsewhere — today, the amounts inside a `ChangeRow` the Scenario
 * Changes table built with `compactCurrency`.
 *
 * `raw` is deliberately null. The two formatters disagree on real values, not
 * just on case: `compactCurrency(1500)` is "$1.5k" where `fmtUsdCompact(1500)`
 * is "$2K". Parsing "$1.5k" back to 1500 so `raw` could hold a number would
 * invite exactly the round trip that prints a different number to a client, and
 * nothing compares these figures — they are quoted, never re-rendered. A
 * plausible-but-wrong `raw` is worse than an absent one.
 *
 * `display` must be a token `validate/facts.ts#extractFigures` actually returns
 * from the source text, not a substring chosen by hand: that is what makes the
 * gate's exact-spelling check true by construction.
 */
export function quotedFact(id: string, label: string, display: string): Fact {
  return { id, label, display, raw: null };
}

export function factDisplaySet(facts: Fact[]): Set<string> {
  return new Set(facts.map((f) => f.display));
}
