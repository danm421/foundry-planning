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
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import { buildBaseResolveData, buildAssetTxResolveData } from "@/lib/scenario/scenario-changes-resolve";
import { describeChange } from "@/lib/presentations/pages/scenario-changes/describe";
import { buildResolveContext } from "@/lib/presentations/pages/scenario-changes/describe/resolve";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import { retirementInflows } from "@/lib/retirement/retirement-inflows";
import { liquidPortfolioTotal as balanceSheetLiquidTotal } from "@/lib/presentations/pages/balance-sheet/view-model";
import { buildViewModel } from "@/components/balance-sheet-report/view-model";
import { buildViewModelInputs } from "@/lib/balance-sheet/build-view-model-inputs";
import { mergeSyntheticAccounts } from "@/lib/balance-sheet/merge-synthetic-accounts";
import { buildMapBoards } from "@/lib/household-map/build-boards";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import { summarizeHousehold } from "@/lib/presentations/pages/estate-summary/aggregate";
import { ESTATE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/estate-summary/options-schema";
import { computeLifetimeTotals } from "@/lib/presentations/pages/tax-summary/aggregate";
import { ASSUMED_LIFE_EXPECTANCY } from "@/lib/plan-horizon";
import type { GoalKind, MapGoal } from "@/lib/household-map/goals";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { buildStoryFacts, groupStrategies, type StoryEstateTotals } from "./build-facts";
import type { StoryContext, StoryGoal, StoryStrategy } from "./types";

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

/**
 * The goal KINDS chapter 1 is about, in the words a client would use.
 *
 * The Goals board also carries the three life milestones — both retirements,
 * the end of the plan — and those are deliberately absent. They are not things
 * the household wants the money to DO; they are the horizon, and the horizon is
 * already two facts in the pack, printed by this chapter's own first sentence.
 * Listing them again would open the report by telling the reader that their
 * retirement is a goal of theirs.
 */
const STORY_GOAL_KINDS: Partial<Record<GoalKind, string>> = {
  education: "Education",
  purchase: "Purchase",
  household: "Household",
};

/**
 * The household's own goals, off the SAME builder the Household Map's Goals
 * board draws.
 *
 * `buildMapBoards` rather than a private read of the expense rows: a goal
 * anchored to a milestone ("at retirement") has its year RESOLVED there, so a
 * scenario that moves the retirement age moves the goal with it. A second
 * implementation here would drift from the board a client sees on the next page
 * of the same deck. `buildMapGoalsData` is still avoided, as the plan asks —
 * that one returns a laid-out board with columns and cards, which is a page's
 * shape rather than a fact's.
 *
 * `year` is therefore never null on this path; `StoryGoal` allows it because an
 * open-ended goal is a real thing the data model does not carry yet, and the
 * narrator already handles it.
 */
function storyGoals(effectiveTree: ClientData, today: Date): StoryGoal[] {
  const client = effectiveTree.client;
  const { goals } = buildMapBoards({
    effectiveTree,
    identity: {
      dateOfBirth: client.dateOfBirth,
      spouseDob: client.spouseDob ?? null,
      lifeExpectancy: client.lifeExpectancy ?? ASSUMED_LIFE_EXPECTANCY,
    },
    familyMemberRows: effectiveTree.familyMembers ?? [],
    entityRows: (effectiveTree.entities ?? []).map((e) => ({ id: e.id, name: e.name ?? "Entity" })),
    today,
  });

  return goals.flatMap((goal: MapGoal) => {
    const kind = STORY_GOAL_KINDS[goal.kind];
    return kind ? [{ name: goal.title, year: goal.year, kind }] : [];
  });
}

/**
 * The first year the plan cannot cover its own spending, or null when it never
 * does.
 *
 * `retirementInflows` rather than a definition of our own: it is the app's
 * existing answer to "does this year fund itself", mirroring the Cash Flow
 * report's inflow stack (Social Security, salaries, other, RMDs, withdrawals)
 * and already driving the Retirement Analysis hero chart and year table. A
 * second definition here would put a different year on the client's page than
 * the one the advisor sees on screen — and the advisor would be the one asked
 * about it.
 */
function firstShortfallYear(years: ProjectionYear[]): number | null {
  return years.find((y) => retirementInflows(y).shortfall > 0)?.year ?? null;
}

/**
 * The most this plan can spend a year, THROUGH the compute cache so the render
 * step reuses the solve rather than paying for a second identical one.
 *
 * Fails exactly the way Monte Carlo does: non-fatal, logged with the
 * `[plan-story]` prefix, and the fact is then simply absent. Never zeroed — this
 * is the figure a client is most likely to act on, and a $0 printed because a
 * solver timed out is the worst lie this report could tell.
 *
 * `unreachable` is treated as no answer for the same reason: the solver reports
 * it when there is no spend that clears the target, and a figure carried out of
 * that state is not the one the label promises.
 */
async function maxSpendFor(clientId: string, firmId: string, ref: string): Promise<number | null> {
  try {
    // Returns the solve directly, unlike `getOrComputeMonteCarlo`'s `{ payload }`.
    const { realAnnualSpend, status } = await getOrComputeMaxSpending({
      clientId,
      firmId,
      scenarioId: ref,
    });
    return status === "unreachable" || realAnnualSpend <= 0 ? null : realAnnualSpend;
  } catch (err) {
    console.error("[plan-story] max spending unavailable (non-fatal)", err);
    return null;
  }
}

/**
 * What one plan's estate leaves behind, off the SAME report the deck's Estate
 * Summary page builds its KPI strip from: `summarizeHousehold` over
 * `buildEstateTransferReportData` at `asOf: { kind: "split" }`, which is that
 * page's End of Life column. Under `documentRole: "frontMatter"` the two pages
 * are a few leaves apart in one PDF, and "what reaches your heirs" meaning two
 * different numbers inside one document is the single failure this fact pack
 * exists to prevent.
 *
 * End of life rather than today, because that is the horizon this chapter's
 * neighbours are stated at — `outcome.legacy.*` is already "left at the end".
 *
 * `ordering` is that page's own default. Which death is reported first is an
 * option the advisor sets on the Estate Summary page, which this one cannot
 * see; the two figures below are the sum across both deaths either way.
 *
 * Null for an empty report, never zeroes: no estate on file and an estate worth
 * nothing are different statements, and only the first is honest to print.
 */
function estateTotals(
  projected: Projected,
  ownerNames: { clientName: string; spouseName: string | null },
): StoryEstateTotals | null {
  const report = buildEstateTransferReportData({
    projection: projected.projection,
    asOf: { kind: "split" },
    ordering: ESTATE_SUMMARY_OPTIONS_DEFAULT.ordering,
    clientData: projected.effectiveTree,
    ownerNames,
  });
  if (report.isEmpty) return null;
  const household = summarizeHousehold(report);
  return { net: household.netToHeirs, cost: household.taxAndCosts };
}

/**
 * Income tax over the whole plan, off the SAME totals the deck's Tax Comparison
 * page puts in its "Lifetime Total Tax" KPI.
 *
 * Null when NO year carries a tax result. `computeLifetimeTotals` sums whatever
 * `taxResult` each year holds and returns 0 when none of them does, which is
 * indistinguishable from a household that genuinely owes nothing — and "$0 in
 * income tax over the whole plan" printed because the tax engine did not run is
 * exactly what the null-rather-than-zero rule exists to stop.
 */
function lifetimeTax(years: ProjectionYear[]): number | null {
  if (!years.some((y) => y.taxResult?.flow)) return null;
  return computeLifetimeTotals(years).lifetimeTotal;
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

  // BASE, not the proposal. Chapter 1 opens on what the household is planning
  // for — that is theirs, and it does not change because we recommended a Roth
  // conversion. The proposal's effect on those goals is what the chapters after
  // it are for.
  const goals = storyGoals(base.effectiveTree, new Date());

  // Both refs at once, so the two solves overlap rather than queue. A snapshot
  // proposal has no scenario id to solve against, exactly as its Monte Carlo
  // does not — `projectAndMc` already left `successRate` null for the same
  // reason, and borrowing the base plan's spend would print it under the
  // proposed plan's label.
  const [baseSpend, proposedSpend] = await Promise.all([
    maxSpendFor(clientId, firmId, "base"),
    proposed?.scenarioId != null ? maxSpendFor(clientId, firmId, proposed.scenarioId) : null,
  ]);

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
    // The SAME array the context carries below. `goalYearFactId` keys a goal's
    // date by its position, so these two must be one array, not two reads.
    goals,
    /**
     * This year's cash flow, off the SAME projection year the deck's Cash Flow
     * page charts. A client checks this chapter against their own bank
     * statement, so a figure that differs from the page a few leaves later is a
     * figure that costs the advisor the meeting.
     *
     * `saving` is `totalExpenses - expenses.total`, not `savings.total`. The
     * engine's Total Expenses line is `expenses.total + savings.total +
     * hypoContribution` — that third term is the self-funding contribution a
     * savings rule with `fundFromExpenseReduction` makes, which is real money
     * put away and is absent from `savings.total`. Taking the difference means
     * the two outflow figures always sum to the Cash Flow page's own Total
     * Expenses, and income minus both is exactly its Net Cash Flow. Reading
     * `savings.total` directly would have told a self-funding household it had
     * headroom it does not have.
     */
    shortfallYear: firstShortfallYear(baseYears),
    maxSpend: { base: baseSpend, proposed: proposedSpend },
    // The names only label the report's own death sections, which nothing here
    // reads — the two figures taken off it are household totals.
    estate: {
      base: estateTotals(base, { clientName: firstName, spouseName: client.spouseName ?? null }),
      proposed: proposed
        ? estateTotals(proposed, { clientName: firstName, spouseName: client.spouseName ?? null })
        : null,
    },
    // No proposal means no proposed years, which is already null by the rule
    // above rather than by a second check here.
    lifetimeTax: { base: lifetimeTax(baseYears), proposed: lifetimeTax(proposedYears) },
    flow: firstYear
      ? {
          income: firstYear.totalIncome,
          spending: firstYear.expenses.total,
          saving: firstYear.totalExpenses - firstYear.expenses.total,
        }
      : null,
  });

  return {
    household: { firstNames, householdName },
    scenarioLabel: args.scenarioLabel,
    documentRole: args.documentRole,
    hasProposal: proposedRef != null,
    strategies,
    goals,
    facts,
  };
}
