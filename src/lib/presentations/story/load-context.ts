// The single IO boundary of the story core. Loads base (and optionally
// proposed), reads Monte Carlo THROUGH THE COMPUTE CACHE so the render step
// reuses it rather than paying for a second identical simulation, describes the
// scenario's changes, and hands everything to the pure builders.
//
// Monte Carlo failure is non-fatal: the confidence facts are simply absent,
// which the narratives and prompts already handle. It is never zeroed — a 0%
// confidence figure printed in a client document would be a lie.
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { resolveScenarioRef } from "@/lib/scenario/presentation-refs";
import { runProjectionWithEvents } from "@/engine/projection";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import { buildBaseResolveData, buildAssetTxResolveData } from "@/lib/scenario/scenario-changes-resolve";
import { describeChange } from "@/lib/presentations/pages/scenario-changes/describe";
import { buildResolveContext } from "@/lib/presentations/pages/scenario-changes/describe/resolve";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import { liquidPortfolioTotal as balanceSheetLiquidTotal } from "@/lib/presentations/pages/balance-sheet/view-model";
import { buildViewModel } from "@/components/balance-sheet-report/view-model";
import { buildViewModelInputs } from "@/lib/balance-sheet/build-view-model-inputs";
import { mergeSyntheticAccounts } from "@/lib/balance-sheet/merge-synthetic-accounts";
import { buildStoryFacts, groupStrategies } from "./build-facts";
import type { StoryContext, StoryStrategy } from "./types";

export interface LoadStoryContextArgs {
  clientId: string;
  firmId: string;
  /** Raw scenario ref for the proposed plan, or null for a base-only story. */
  proposedRef: string | null;
  scenarioLabel: string;
  documentRole: "standalone" | "frontMatter";
}

/**
 * Effective tree + deterministic projection for one ref, plus its Monte Carlo
 * success rate read FROM THE COMPUTE CACHE. Routing MC through
 * `getOrComputeMonteCarlo` (rather than a raw, uncached `runMonteCarlo`) means
 * the PDF render step reuses this result instead of recomputing the identical
 * 1000-trial simulation. Mirrors `retirement-comparison/generate-ai.ts`.
 *
 * `scenarioId` is null for a SNAPSHOT ref — a frozen tree with no scenario row
 * behind it, so there is no id that would key its Monte Carlo or its change
 * rows. Everything keyed on it is then skipped rather than falling back to
 * "base": borrowing the base plan's success rate would print it under
 * "Confidence, proposed plan", and a mislabelled figure is worse than an absent
 * one. The tree is still projected, so the snapshot's own legacy figure stays
 * true.
 */
async function projectAndMc(clientId: string, firmId: string, raw: string) {
  const ref = resolveScenarioRef(raw);
  const scenarioId = ref.kind === "scenario" ? ref.id : null;
  const { effectiveTree } = await loadEffectiveTreeForRef(clientId, firmId, ref);
  const projection = runProjectionWithEvents(effectiveTree);
  let successRate: number | null = null;
  if (scenarioId != null) {
    try {
      const cached = await getOrComputeMonteCarlo({ clientId, firmId, scenarioId });
      successRate = cached.payload.summary.successRate;
    } catch (err) {
      console.error("[plan-story] Monte Carlo unavailable (non-fatal)", err);
    }
  }
  return { scenarioId, effectiveTree, projection, successRate };
}

type Projected = Awaited<ReturnType<typeof projectAndMc>>;

/**
 * The proposed scenario's changes, described exactly as the Scenario Changes
 * table describes them and grouped one strategy per toggle group.
 *
 * The resolve maps are built off the effective tree so a change reads
 * "Joint Brokerage" rather than "an account" — the same assembly
 * `render-presentation-pdf.ts` does, minus the reinvestment enrichment, which
 * needs the firm's investment catalog and degrades to a blended-rate-only line
 * without it.
 */
async function loadStrategies(clientId: string, proposed: Projected): Promise<StoryStrategy[]> {
  const { scenarioId } = proposed;
  // A snapshot is a frozen tree; no scenario row holds change rows for it, and
  // querying "base" instead would recommend changes the proposal doesn't make.
  if (scenarioId == null) return [];

  const [changes, toggleGroups] = await Promise.all([
    loadScenarioChanges(scenarioId),
    loadScenarioToggleGroups(scenarioId),
  ]);

  const ctx = {
    targetNames: buildTargetNames(proposed.effectiveTree, clientId),
    resolve: buildResolveContext({
      ...buildBaseResolveData(proposed.effectiveTree),
      // Projection-derived value bought/sold and net cash received. A pure
      // reshape of an already-computed breakdown, so it is always safe.
      assetTxById: buildAssetTxResolveData(proposed.projection.years),
    }),
  };

  return groupStrategies(
    changes.map((c) => ({ change: c, row: describeChange(c, ctx) })),
    toggleGroups,
  );
}

export async function loadStoryContext(args: LoadStoryContextArgs): Promise<StoryContext> {
  const { clientId, firmId, proposedRef } = args;

  const [base, proposed] = await Promise.all([
    projectAndMc(clientId, firmId, "base"),
    proposedRef ? projectAndMc(clientId, firmId, proposedRef) : null,
  ]);

  const client = base.effectiveTree.client;
  const firstName = client.firstName || "the household";
  const firstNames = client.spouseName ? `${firstName} and ${client.spouseName}` : firstName;
  const householdName = `the ${client.lastName ?? firstName} household`;

  const baseYears = base.projection.years;
  const firstYear = baseYears[0];
  const lastYear = baseYears[baseYears.length - 1];
  const proposedYears = proposed?.projection.years ?? [];
  const proposedLast = proposedYears[proposedYears.length - 1];

  // Household totals come from the balance-sheet view-model, not the projection
  // year — ProjectionYear carries portfolio buckets, not a balance sheet. Same
  // builder the Balance Sheet page and the on-screen report use, so a figure
  // cannot mean one thing here and another there.
  const { accounts, liabilities, entities, familyMembers } = buildViewModelInputs(
    mergeSyntheticAccounts(base.effectiveTree, baseYears),
  );
  const balanceSheet = buildViewModel({
    accounts,
    liabilities,
    entities,
    familyMembers,
    projectionYears: baseYears,
    selectedYear: firstYear?.year ?? 0,
    view: "consolidated",
    asOfMode: "today",
  });

  // Strategies BEFORE the facts, and the same array to both: the pack quotes
  // the strategy rows' own figures, and the recommendation chapter may only
  // print a row's text when every figure in it is grounded. Building the pack
  // without them leaves that chapter with nothing but a generic clause.
  const strategies = proposed ? await loadStrategies(clientId, proposed) : [];

  const facts = buildStoryFacts({
    todayAssets: balanceSheet.totalAssets,
    todayDebts: balanceSheet.totalLiabilities,
    // Off the SAME balance sheet as the two figures above, not off the
    // projection year. `portfolioAssets` is snapshotted at the END of the year
    // loop (projection.ts — "after the surplus allocation") while
    // `asOfMode: "today"` reads beginning-of-year balances, and the engine's
    // helper sums taxable + cash + retirement where the deck's own Balance
    // Sheet page also counts annuity and life insurance. Under
    // `documentRole: "frontMatter"` that page is a few leaves later in the same
    // PDF, so the two have to be one number.
    todayLiquid: balanceSheetLiquidTotal(balanceSheet.assetCategories),
    baseSuccess: base.successRate,
    proposedSuccess: proposed?.successRate ?? null,
    // The legacy figures stay on the ENGINE helper: they are the end-of-plan
    // balance the Monte Carlo judged success against, so matching its
    // definition is the whole point of them.
    baseEndLiquid: lastYear ? liquidPortfolioTotal(lastYear) : 0,
    proposedEndLiquid: proposedLast ? liquidPortfolioTotal(proposedLast) : null,
    retirementYear: new Date(client.dateOfBirth).getUTCFullYear() + client.retirementAge,
    endOfLifeYear: lastYear?.year ?? 0,
    // The projection's own first year, not the wall clock: the whole report is
    // written against the plan's horizon, and `firstYear` is what every other
    // figure here is as-of.
    planStartYear: firstYear?.year ?? new Date().getUTCFullYear(),
    strategies,
  });

  return {
    household: { firstNames, householdName },
    scenarioLabel: args.scenarioLabel,
    documentRole: args.documentRole,
    hasProposal: proposedRef != null,
    strategies,
    facts,
  };
}
