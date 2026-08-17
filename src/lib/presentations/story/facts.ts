// The single place a client-facing figure becomes a string. The model is
// handed `display` values and is forbidden from formatting anything itself,
// so rounding rules cannot drift between two chapters of the same report.
import { fmtUsdCompact } from "@/lib/presentations/pages/retirement-comparison/format";
// Type-only, so the cycle with `types.ts` (which imports `Fact` from here) is
// erased at compile time and never exists at runtime.
import type { ChapterId } from "./types";

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
  /**
   * The chapters this figure belongs to. Absent — the case for every plan-level
   * total — means every chapter, which is the right default for a household
   * number that is true wherever it is printed.
   *
   * Set it when a figure is only meaningful in one place. Gate 1 checks a
   * figure's SPELLING, never its meaning, so an unscoped pack licenses every
   * chapter to print every figure in it: a proposed rental sale price is
   * grammatical inside a chapter about today's balance sheet, and nothing
   * downstream can tell that it is wrong. Read it through
   * `types.ts#factsForChapter`, never by hand.
   */
  chapters?: readonly ChapterId[];
  /**
   * The one chapter this figure BELONGS to, when a client should meet it in a
   * particular place rather than wherever it happens to fit.
   *
   * Distinct from `chapters`, and the difference is the whole point. `chapters`
   * decides what a chapter may SAY, and getting it wrong puts a proposed rental
   * sale price inside a chapter about today's balance sheet. `primary` decides
   * only where a figure is EMPHASISED: `factsForChapter` ignores it entirely, and
   * `chapters/prompts.ts` prints an unowned figure under a second heading rather
   * than dropping it — so what the model is SHOWN stays equal to what Gate 1
   * allows, which is the rule `types.ts#factsForChapter` states. All that moves
   * is which of the two lists a figure is on.
   *
   * ⚠️ It must name a chapter the fact can actually reach — a member of its own
   * `chapters` when it has one — and it does nothing at all when that scope holds
   * a single chapter, since the only chapter that sees the fact is then the one
   * that owns it. `__tests__/build-facts.test.ts` sweeps every emitted fact for
   * both, because neither is checked at runtime.
   *
   * Why it exists, measured on a live-model checkpoint run 2026-08-14: the two
   * facts `build-facts.ts` emits with no `chapters` — the retirement year and the
   * horizon's last year — reached all fourteen chapters, and the report named
   * them in 12 of 14. "2035 is when work income stops" opened a paragraph in 7 of
   * 14, and 22 of 48 paragraphs opened with the shape `<figure> is <what it is>`.
   * Fourteen chapters handed the same numbers wrote the same numbers, which read
   * as one template repeated whatever voice was layered over it.
   */
  primary?: ChapterId;
}

/**
 * `chapters` is optional on these three and required on `quotedFact`, which is
 * the difference between the two kinds of figure: a plan total is true wherever
 * it is printed, and a quoted one is about one specific change. Omit it and the
 * fact is plan-level — see `Fact.chapters`.
 */
export function moneyFact(
  id: string,
  label: string,
  raw: number,
  chapters?: readonly ChapterId[],
): Fact {
  return { id, label, display: fmtUsdCompact(raw), raw, ...(chapters ? { chapters } : {}) };
}

/** `raw` is a fraction: 0.91 → "91%". At most one decimal, no trailing ".0". */
export function pctFact(
  id: string,
  label: string,
  raw: number,
  chapters?: readonly ChapterId[],
): Fact {
  const pct = raw * 100;
  const display = `${Number.isInteger(pct) ? pct : Number(pct.toFixed(1))}%`;
  return { id, label, display, raw, ...(chapters ? { chapters } : {}) };
}

/**
 * `primary` is here and on none of the other three factories, because the only
 * two facts that carry one are years — see `build-facts.ts`. The others take the
 * parameter when a figure actually needs one; an argument nothing passes is an
 * argument nothing checks.
 */
export function yearFact(
  id: string,
  label: string,
  raw: number,
  chapters?: readonly ChapterId[],
  primary?: ChapterId,
): Fact {
  return {
    id,
    label,
    display: String(Math.round(raw)),
    raw,
    ...(chapters ? { chapters } : {}),
    ...(primary ? { primary } : {}),
  };
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
 *
 * `chapters` is required rather than optional here. A quoted figure is about one
 * specific change, so the chapter it belongs to is part of knowing what it
 * means — and defaulting it to "everywhere" is exactly the mistake the field
 * exists to prevent.
 */
export function quotedFact(
  id: string,
  label: string,
  display: string,
  chapters: readonly ChapterId[],
): Fact {
  return { id, label, display, raw: null, chapters };
}

/**
 * Does this text write a negative the way an accounting table does?
 * `compactCurrency` renders -50000 as "($50k)"; this document has no such form,
 * so a clause containing one is never printed and its figures are never quoted.
 *
 * Tested against the TEXT and not against the figure, which is the whole point:
 * `extractFigures("($50k)")` returns "$50k", parens excluded, so a token lifted
 * out of one is indistinguishable from an ordinary positive amount. Grounding
 * alone therefore cannot catch it — a "$50k" quoted legitimately from one change
 * will happily ground a "($50k)" in another. Every module that quotes text it
 * did not format owes this check, so it lives here with the formatters rather
 * than in one of them.
 */
export function hasAccountingNegative(text: string): boolean {
  return /\(\s*\$/u.test(text);
}

export function factDisplaySet(facts: Fact[]): Set<string> {
  return new Set(facts.map((f) => f.display));
}

/**
 * Every label in the pack, lowercased.
 *
 * The sibling of `factDisplaySet`, and the input to Gate 5. A label is a
 * machine-readable key we hand the model so it knows what a figure MEANS; the
 * model reliably reads it back as English ("Left at the end, current plan:
 * $9.2M"). Lowercased here rather than at each comparison so the gate does one
 * `has` per candidate rather than a scan.
 */
export function factLabelSet(facts: Fact[]): Set<string> {
  return new Set(facts.map((f) => f.label.toLowerCase()));
}
