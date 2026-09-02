// What the heirs actually keep — one implementation, read by both the page's
// KPI strip (view-model.ts) and the AI commentary (generate-ai.ts). A second
// copy is how the card and the paragraph under it start disagreeing inside one
// PDF, which is the failure this whole page family keeps re-learning.
import type { ClientData, ProjectionResult } from "@/engine";
import { estateDistributionAtYear } from "@/lib/estate/estate-distribution-at-year";

/** One plan's estate outcome at the final death. */
export interface AfterTaxLegacy {
  /** What the heirs keep, after every line below. */
  toHeirs: number;
  /** Estate tax + probate/administration + IRD. */
  taxesAndCosts: number;
  /** The income tax on inherited pre-tax accounts, already inside
   *  `taxesAndCosts` — the line a Roth conversion moves. */
  ird: number;
}

export interface AfterTaxLegacyArgs {
  projection: ProjectionResult;
  clientData: ClientData;
  ownerNames: { clientName: string; spouseName: string | null };
  /** Used only when the projection carries no death events — see below. */
  fallbackYear: number;
}

/**
 * The estate report's own `toHeirs`: the portfolio at the final death less
 * federal and state estate tax, probate and administration, debts, and the
 * income tax an heir owes on an inherited pre-tax account (IRD). Charity is
 * excluded, because the figure is labelled "heirs".
 *
 * The end-of-life portfolio total this replaced is a PRE-tax figure. On a real
 * plan holding $3.7M of pre-tax IRAs the difference was $1.4M, and printing the
 * gross charged a Roth conversion for pre-paying tax the heirs would have owed
 * anyway — it made every conversion scenario look like a legacy destroyer, on
 * the page that exists to judge exactly that trade.
 *
 * Read through the same builder as the Solver's "Total to Heirs" tile, so the
 * deck and the app cannot answer the question differently.
 *
 * Anchored at the second death, which is where the projection stops. A bundle
 * carrying no death events (the live Solver builds its comparison bundles from
 * projection years alone) falls back to its last projected year — the same row
 * the page's "At end of life" table reads. Null when there is no estate model
 * to read: callers hide the figure rather than fall back to the gross, because
 * the gross under this label is the defect, not a degraded version of it.
 */
export function afterTaxLegacy(args: AfterTaxLegacyArgs): AfterTaxLegacy | null {
  const dist = estateDistributionAtYear({
    projection: args.projection,
    year: args.projection.secondDeathEvent?.year ?? args.fallbackYear,
    clientData: args.clientData,
    ownerNames: args.ownerNames,
  });
  if (dist.isEmpty) return null;
  return { toHeirs: dist.toHeirs, taxesAndCosts: dist.taxesAndExpenses, ird: dist.ird };
}
