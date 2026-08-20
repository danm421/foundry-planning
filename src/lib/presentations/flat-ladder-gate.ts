// Why a savings-rate chart can come out flat, told before the advisor prints it.
//
// "What Saving More Is Worth" draws the same portfolio under three payroll
// deferral rates. The bars only separate when the household's surplus is NOT
// already invested: if every leftover dollar is swept into the portfolio, a
// higher deferral merely RELOCATES those dollars from the taxable side into the
// 401(k), and the three bars land within a fraction of a percent of each other.
// Measured end to end on the dev trees: the same rungs move the age-65
// portfolio 0.5% for a household with no absorbing living row and 18% for the
// same household with one.
//
// So it is a DATA condition, not a defect, and it is invisible from the chart —
// three near-identical bars look like an answer, not a misconfiguration.
//
// SOFT and unaudited, unlike the Plan Story gate beside it: nothing here is a
// compliance control, it is a "check this before you present it" note. Reads
// storage ONLY — no projection — so an export is never slower for it.
import { baseCaseScenarioId } from "@/lib/clients/base-case";
import { hasAbsorbingLivingRow } from "@/lib/clients/expenses-reads";
import { EARLY_YEARS_LADDER_PAGE_ID } from "@/lib/presentations/pages/early-years-ladder/view-model";
import type { PresentationPageDescriptor } from "@/lib/presentations/types";

/** Names the page by its printed title and the toggle by the words the expense
 *  dialog puts on it ("Spend whatever's left each year"), so the advisor can
 *  find both. */
export const FLAT_LADDER_WARNING =
  "“What Saving More Is Worth” will read nearly flat for this plan: " +
  "no living expense is set to spend whatever’s left each year, so raising " +
  "the savings rate only moves dollars the plan already invests.";

/**
 * The warning to show beside a completed export, or null when there is nothing
 * to say. Storage errors are the CALLER's to swallow — a note about a deck must
 * not be able to fail the deck, and that policy belongs where the response is
 * built, not hidden in a silent catch here.
 */
export async function flatLadderWarning(
  clientId: string,
  firmId: string,
  pages: PresentationPageDescriptor[],
): Promise<string | null> {
  // Early, and before any query: most decks hold no ladder page, and a check
  // about a chart they do not contain must cost them nothing.
  if (!pages.some((p) => p.pageId === EARLY_YEARS_LADDER_PAGE_ID)) return null;

  // The chart is pinned to Base Case (`requiredScenarioRefs: () => ["base"]`),
  // so the row that decides this is the base tree's whatever scenario the rest
  // of the deck is built on. No base case means the page cannot render at all —
  // the render's own error is the honest message, not a note about flat bars.
  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (scenarioId == null) return null;

  return (await hasAbsorbingLivingRow(clientId, scenarioId))
    ? null
    : FLAT_LADDER_WARNING;
}
