// Where the story context is ASSEMBLED, and most of its IO. Loads base (and
// optionally proposed), reads Monte Carlo THROUGH THE COMPUTE CACHE so the
// render step reuses it rather than paying for a second identical simulation,
// describes the scenario's changes, and hands everything to the pure builders.
//
// Not the story core's ONLY query: `scenario-label.ts`, `repo.ts`,
// `scenario-scope.ts` and `load-next-steps.ts` each own one of their own — a
// single scoped read with a mapping and a suite beside it.
//
// Monte Carlo failure is non-fatal: the confidence facts are simply absent,
// which the narratives and prompts already handle. It is never zeroed — a 0%
// confidence figure printed in a client document would be a lie.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts } from "@/db/schema";
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
import {
  summarizeHousehold,
  type EstateSummaryHousehold,
} from "@/lib/presentations/pages/estate-summary/aggregate";
import { estateChartBar } from "@/lib/presentations/pages/estate-summary/view-model";
import { ESTATE_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/estate-summary/options-schema";
import { computeLifetimeTotals } from "@/lib/presentations/pages/tax-summary/aggregate";
import { buildMedicareBars, computeKpis } from "@/lib/presentations/pages/medicare-summary/aggregate";
import { coverageForDecedent } from "@/lib/presentations/pages/life-insurance-summary/aggregate";
import { getOrComputeLifeInsuranceSolve } from "@/lib/compute-cache/life-insurance";
import { loadLifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { loadLifeInsuranceSettings } from "@/lib/life-insurance/settings";
import { listInvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import { roundUpTo50k } from "@/lib/life-insurance/round";
import { ASSUMED_LIFE_EXPECTANCY } from "@/lib/plan-horizon";
import type { GoalKind, MapGoal } from "@/lib/household-map/goals";
import type { LiSolved } from "@/lib/presentations/pages/life-insurance-summary/options-schema";
import type { LiPolicyRow } from "@/lib/insurance-policies/load-li-inventory";
import type { ClientData, ProjectionYear } from "@/engine/types";
import {
  buildStoryFacts,
  groupStrategies,
  COVER_CHAPTERS,
  SPEND_CHAPTERS,
  type StoryCover,
  type StoryEstateTotals,
} from "./build-facts";
import { buildStoryCharts, type StoryEstateChart } from "./charts";
import { loadStoryNextSteps } from "./load-next-steps";
import { CHECKLIST_CHAPTERS } from "./chapters/registry";
import type { ChapterId, StoryContext, StoryGoal, StoryStrategy, StoryHousehold } from "./types";

/**
 * The ONE spelling of how this document names a household. Every chapter's
 * framing, and every name the scrubber has to take back OUT of a harvested
 * sample, comes from here — so the two cannot disagree about what "the Sample
 * household" is, which is the disagreement that would leave a real surname
 * sitting in another household's prompt.
 *
 * ⚠️ It carries a known hole rather than fixing it, because the SAMPLES have to
 * be scrubbed against exactly what the chapters said: a client with no first
 * name and no surname on file gets `firstNames: "the household"` and
 * `householdName: "the the household household"`. Improving it here without
 * improving what the shipped chapters say would break the match.
 */
export function composeStoryHousehold(client: {
  firstName: string;
  lastName?: string | null;
  spouseName?: string | null;
}): StoryHousehold {
  const firstName = client.firstName || "the household";
  return {
    firstNames: client.spouseName ? `${firstName} and ${client.spouseName}` : firstName,
    householdName: `the ${client.lastName ?? firstName} household`,
  };
}

/**
 * The same two strings, for a caller that has a client id and no projection.
 *
 * `loadStoryContext` below reads them off the effective tree it already loaded;
 * that load is measured in SECONDS, and the samples route only needs the names.
 * So this goes to the one place the names actually live: `crm_household_contacts`,
 * primary and spouse BY ROLE. There is no name column on `clients` at all — the
 * CRM contacts are the sole source of identity, which is exactly how
 * `load-client-data.ts:156-158` builds `ClientData.client`. Following any other
 * route to a name would be inventing a second source for the scrubber to
 * disagree with the chapters about.
 *
 * Throws rather than returning blanks when the client or its primary contact is
 * missing — the same condition `load-client-data.ts` throws on. A caller that
 * cannot learn the names must not go on to store text it cannot scrub.
 */
export async function loadStoryHousehold(
  clientId: string,
  firmId: string,
): Promise<StoryHousehold> {
  const [client] = await db
    .select({ crmHouseholdId: clients.crmHouseholdId })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) throw new Error(`Client ${clientId} not found in firm ${firmId}`);

  const contacts = await db
    .select({
      role: crmHouseholdContacts.role,
      firstName: crmHouseholdContacts.firstName,
      lastName: crmHouseholdContacts.lastName,
    })
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
  const primary = contacts.find((c) => c.role === "primary");
  if (!primary) throw new Error(`Client ${clientId} has no primary CRM contact`);
  const spouse = contacts.find((c) => c.role === "spouse");

  return composeStoryHousehold({
    firstName: primary.firstName,
    lastName: primary.lastName,
    spouseName: spouse?.firstName,
  });
}

export interface LoadStoryContextArgs {
  clientId: string;
  firmId: string;
  /** Raw scenario ref for the proposed plan, or null for a base-only story. */
  proposedRef: string | null;
  scenarioLabel: string;
  documentRole: "standalone" | "frontMatter";
  /**
   * The chapters that COULD print, so the loader can skip the facts nothing
   * will read. ABSENT MEANS ALL — every caller that does not care, and every
   * fixture, keeps loading everything.
   *
   * ⚠️⚠️ IT MUST BE A SUPERSET OF WHAT ACTUALLY GETS NARRATED. Withhold a
   * chapter's facts and its narrator prints its honest empty state instead —
   * a wrong page in a document handed to a client, and one no gate, no page
   * count and no type can see. Both callers derive it from something known
   * BEFORE the facts exist (`printedChapters` on the export, the ref alone in
   * the generate route) precisely so it cannot be narrower than what follows.
   *
   * It buys SPEND, nothing else: the sheet is still reserved and the chapter
   * still prints. So the two SOLVES read it — the life-cover search and the
   * max-spend bisection, the only calls here worth skipping — and each gates on
   * the very list `build-facts.ts` scopes its facts to, so widening a scope
   * widens the load rather than quietly under-loading it. `medicareTotals` and
   * the estate and tax totals are pure sums over years already in memory; a
   * predicate for a free call is a second thing to get wrong.
   */
  chapters?: readonly ChapterId[];
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
 * What one plan's estate leaves behind at one moment, off the SAME report the
 * deck's Estate Summary page builds its KPI strip from: `summarizeHousehold`
 * over `buildEstateTransferReportData`. `asOf: { kind: "split" }` is that page's
 * End of Life column and `{ kind: "today" }` its Today column. Under
 * `documentRole: "frontMatter"` the two pages are a few leaves apart in one PDF,
 * and "what reaches your heirs" meaning two different numbers inside one
 * document is the single failure this fact pack exists to prevent.
 *
 * The fact pack states end of life, because that is the horizon this chapter's
 * neighbours are stated at — `outcome.legacy.*` is already "left at the end".
 * Today is drawn only as the left bar of a base-only deck's chart.
 *
 * `ordering` is that page's own default. Which death is reported first is an
 * option the advisor sets on the Estate Summary page, which this one cannot
 * see; the two figures below are the sum across both deaths either way.
 *
 * Null for an empty report, never zeroes: no estate on file and an estate worth
 * nothing are different statements, and only the first is honest to print.
 *
 * The whole household summary comes back beside the pair, because the estate
 * chapter's chart stacks a bar out of the same object: its green segment IS
 * `net` and its four tax-and-cost segments sum to `cost`. Returning the
 * household rather than re-deriving it at the bar site keeps one
 * `summarizeHousehold` call behind both the picture and the paragraph.
 */
function estateAt(
  projected: Projected,
  asOf: { kind: "today" } | { kind: "split" },
  ownerNames: { clientName: string; spouseName: string | null },
): { totals: StoryEstateTotals; household: EstateSummaryHousehold } | null {
  const report = buildEstateTransferReportData({
    projection: projected.projection,
    asOf,
    ordering: ESTATE_SUMMARY_OPTIONS_DEFAULT.ordering,
    clientData: projected.effectiveTree,
    ownerNames,
  });
  if (report.isEmpty) return null;
  const household = summarizeHousehold(report);
  return {
    totals: { net: household.netToHeirs, cost: household.taxAndCosts },
    household,
  };
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

/**
 * What Medicare costs across the plan, off the SAME builder the deck's Medicare
 * Summary page draws its KPI strip from.
 *
 * `buildMedicareBars` gates on a member who is actually ENROLLED, not on the
 * presence of a `medicare` block — the engine emits one for pre-65 years too,
 * carrying `enrolled: false` and zero premiums, and reading those starts the
 * horizon decades early and inflates the total. That exact defect was found and
 * fixed on the Medicare Summary page by two independent reviewers; calling its
 * builder rather than summing the years here is what stops it arriving again.
 *
 * Null when nobody enrols inside the horizon — a household still ten years off
 * 65 has no Medicare figure, which is not the same as one that costs nothing.
 */
function medicareTotals(years: ProjectionYear[]): { lifetime: number; irmaa: number } | null {
  const bars = buildMedicareBars(years);
  if (bars.length === 0) return null;
  const kpis = computeKpis(bars);
  return { lifetime: kpis.lifetimeMedicareCost, irmaa: kpis.lifetimeIrmaa };
}

/** The solver's display cap. `exceeds-cap` means the search saturated against
 *  it rather than finding a face value, so the number is a bound, not an
 *  answer. */
const NO_ANSWER = "exceeds-cap";

/**
 * One life's cover, need and shortfall, or null when the solve did not answer
 * for that life.
 *
 * `exceeds-cap` is treated as no answer, exactly as `unreachable` is on the
 * max-spend solve and for the same reason: a figure carried out of that state is
 * not the one its label promises.
 */
function coverSide(
  on: string,
  policies: LiPolicyRow[],
  decedent: "client" | "spouse",
  mc: LiSolved["mcSpouse"],
  deathYear: number,
): StoryCover | null {
  if (!mc || mc.status === NO_ANSWER) return null;
  // As of the solved death year, so expired term is dropped — the engine
  // excludes it from the need, and counting it inverts the shortfall.
  const have = coverageForDecedent(policies, decedent, deathYear).total;
  // The Life Insurance Summary page's own arithmetic (`view-model.ts#gapFromMc`):
  // the solve returns the ADDITIONAL face value, so what the plan points to is
  // that plus what is already in force. Comparing cover against the additional
  // need alone reported a surplus whenever cover exceeded it.
  const gap = roundUpTo50k(mc.faceValue);
  return { on, have, need: have + gap, gap };
}

/**
 * The label the Life Insurance Summary page would attach to this solve.
 *
 * Resolved rather than stubbed even though this chapter never reads it. The
 * label is NOT part of the solve's cache key, that page DOES print it in its
 * subtitle, and on an export carrying both pages the story loads first — so a
 * placeholder here would become the label that page shows. The catalog is
 * loaded only when there is a portfolio id to name, which the default settings
 * do not carry.
 */
async function modelPortfolioLabel(
  clientId: string,
  firmId: string,
  modelPortfolioId: string | null,
): Promise<string> {
  const FALLBACK = "Plan default rate";
  if (!modelPortfolioId) return FALLBACK;
  const catalog = await listInvestmentOptionCatalog(clientId, firmId);
  return catalog.portfolios.find((p) => p.id === modelPortfolioId)?.name ?? FALLBACK;
}

/**
 * Life cover for the life the household is furthest short on.
 *
 * The solve is the SAME call `render-presentation-pdf.ts` makes for the Life
 * Insurance Summary page, through the same compute cache and under the advisor's
 * own saved solver settings — so a deck carrying both pages pays for one solve,
 * and the two cannot disagree about what is missing.
 *
 * ⚠️ It is also by far the most expensive thing this loader can run: a
 * deterministic need curve for every plan year plus a Monte Carlo search per
 * life. An empty inventory short-circuits it, which is exactly the household
 * whose chapter prints the honest empty state anyway — so a household with no
 * policies on file never pays for it. Failure is non-fatal, and the facts are
 * then absent, the same as Monte Carlo and max spend.
 */
async function lifeCover(args: {
  clientId: string;
  firmId: string;
  tree: ClientData;
  clientName: string;
  spouseName: string | null;
}): Promise<StoryCover | null> {
  const { clientId, firmId, tree, clientName, spouseName } = args;
  try {
    const { policies } = await loadLifeInsuranceInventory(clientId, firmId, clientName, spouseName);
    if (policies.length === 0) return null;

    // The advisor's own saved assumptions for this client — the same row the
    // Life Insurance page's options control seeds itself from, so the two solves
    // share a cache entry rather than each paying for their own.
    const assumptions = await loadLifeInsuranceSettings(clientId, tree);
    const solved = await getOrComputeLifeInsuranceSolve({
      clientId,
      firmId,
      // Base, not the proposal: this chapter needs no proposal, and cover is
      // about the household as it stands.
      scenarioId: "base",
      assumptions,
      modelPortfolioLabel: await modelPortfolioLabel(clientId, firmId, assumptions.modelPortfolioId),
    });

    const { deathYear } = solved.assumptions;
    const sides = [
      coverSide(clientName, policies, "client", solved.mcClient, deathYear),
      spouseName ? coverSide(spouseName, policies, "spouse", solved.mcSpouse, deathYear) : null,
    ].flatMap((side) => (side ? [side] : []));
    if (sides.length === 0) return null;
    // The life they are furthest short on — the one an advisor has to raise.
    // A tie keeps the earlier side, which is the client, because a coin toss
    // between two identical shortfalls should at least be a stable one.
    return sides.reduce((worst, side) => (side.gap > worst.gap ? side : worst));
  } catch (err) {
    console.error("[plan-story] life cover unavailable (non-fatal)", err);
    return null;
  }
}

export async function loadStoryContext(args: LoadStoryContextArgs): Promise<StoryContext> {
  const { clientId, firmId, proposedRef } = args;
  /** Absent means all — an unlisted caller loses nothing. */
  const prints = (id: ChapterId) => args.chapters?.includes(id) ?? true;

  const [base, proposed] = await Promise.all([
    projectAndMc(clientId, firmId, "base"),
    proposedRef ? projectAndMc(clientId, firmId, proposedRef) : null,
  ]);

  const client = base.effectiveTree.client;
  // The household pair is COMPOSED, not spelled out again — `loadStoryHousehold`
  // hands the samples route the identical two strings. It stays composed from the
  // tree rather than calling that helper because the tree is already in hand
  // here: the names are on it, and a second read would be two queries for
  // something this function has already paid for.
  const { firstNames, householdName } = composeStoryHousehold(client);
  /** The estate report's `clientName` — one person, not the pair above. */
  const firstName = client.firstName || "the household";

  const baseYears = base.projection.years;
  const firstYear = baseYears[0];
  const lastYear = baseYears[baseYears.length - 1];
  const proposedYears = proposed?.projection.years ?? [];
  const proposedLast = proposedYears[proposedYears.length - 1];

  // Each plan's end-of-life estate, computed ONCE and read twice — by the
  // chart's bars just below and by the fact pack further down. The names only
  // label the report's own death sections, which nothing here reads; the
  // figures taken off it are household totals.
  const estateOwnerNames = { clientName: firstName, spouseName: client.spouseName ?? null };

  // Today's estate is built ONLY on a base-only deck: a proposal deck already
  // makes two `buildEstateTransferReportData` calls and must keep making
  // exactly those two, inside a loader that already takes ~23s cold.
  //
  // First, so a base deck's pair is reported today-then-end-of-life in the
  // order the Estate Summary page builds it and the order the chart reads.
  const todayEstate = proposed ? null : estateAt(base, { kind: "today" }, estateOwnerNames);
  const baseEstate = estateAt(base, { kind: "split" }, estateOwnerNames);
  const proposedEstate = proposed ? estateAt(proposed, { kind: "split" }, estateOwnerNames) : null;

  // A proposal deck argues what the changes do, so its bars are the two plans.
  // A base-only deck has one plan and argues what time does to it, so its bars
  // are today and the end — the same pair `pages/estate-summary/view-model.ts`
  // draws, built by the same two calls in the same order.
  //
  // Both bars or none, on either deck. One bar is not a comparison, and
  // `chartFor` returns null for a null chart, so the chapter keeps its prose
  // and prints no empty frame.
  const estate: StoryEstateChart | null = proposed
    ? baseEstate && proposedEstate
      ? {
          comparison: "planVsPlan",
          bars: [
            estateChartBar("Current plan", baseEstate.household),
            estateChartBar("Proposed plan", proposedEstate.household),
          ],
        }
      : null
    : todayEstate && baseEstate
      ? {
          comparison: "todayVsEndOfLife",
          bars: [
            estateChartBar("Today", todayEstate.household),
            estateChartBar("End of Life", baseEstate.household),
          ],
        }
      : null;

  // Whichever plan `willTheMoneyLast` is stating — the proposed plan's years
  // when the deck carries one, the base plan's otherwise. That chapter prints
  // under both `OUTCOME_CHAPTERS` and `PROPOSED_OUTCOME_CHAPTERS`
  // (`build-facts.ts`), so on a proposal deck it already states the proposed
  // plan's outcome figures; drawing the base plan's bars here instead would
  // put `chart.portfolio.atEnd` and `outcome.legacy.base` under two different
  // labels for the same number.
  const charts = buildStoryCharts({
    years: proposed ? proposedYears : baseYears,
    estate,
  });

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
  //
  // Each solve is skipped outright when this report prints no chapter that
  // reads it — gated on the SAME list `build-facts.ts` scopes the resulting
  // facts to, so the gate cannot drift from what actually needs the answer.
  // See `chapters` on the args for why absent means all.
  //
  // The spend pair is the common one: `whatYouCanSpend` requires a proposal, so
  // EVERY base-only story — the default deck included — was paying for a
  // 250-trial bisection whose figure it could never print.
  const wantsSpend = SPEND_CHAPTERS.some(prints);
  const [baseSpend, proposedSpend, cover, nextSteps] = await Promise.all([
    wantsSpend ? maxSpendFor(clientId, firmId, "base") : null,
    wantsSpend && proposed?.scenarioId != null
      ? maxSpendFor(clientId, firmId, proposed.scenarioId)
      : null,
    // Alongside the two solves rather than after them — it is the slowest call
    // in this loader and nothing below depends on the other two.
    COVER_CHAPTERS.some(prints)
      ? lifeCover({
          clientId,
          firmId,
          tree: base.effectiveTree,
          clientName: firstName,
          spouseName: client.spouseName ?? null,
        })
      : null,
    // The advisor's own next steps — gated like the two solves, on the list the
    // CONSUMERS are keyed to. These are not facts, so `build-facts.ts` has no
    // scope to read; what reads them is the checklist LAYOUT, in
    // `pages/plan-story/view-model.ts` and `chapter-pdf.tsx`, so the gate reads
    // the registry's own answer to which chapters that is.
    //
    // ⚠️ Absent means all, as everywhere else here — a caller that names no
    // chapters loads the steps. Withholding them would print the chapter's
    // "nothing's been written down yet" state over a list the advisor wrote.
    CHECKLIST_CHAPTERS.some(prints)
      ? loadStoryNextSteps(clientId, {
          clientData: base.effectiveTree,
          projection: base.projection,
          // The base plan's, and null when it did not run. Only the confidence
          // tokens read it, and they resolve to nothing rather than to 0% — the
          // same rule the confidence FACTS are built under.
          monteCarlo: base.successRate == null ? null : { successRate: base.successRate },
        })
      : [],
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
    // Off the same two summaries the chart's bars were stacked from, above.
    estate: {
      base: baseEstate?.totals ?? null,
      proposed: proposedEstate?.totals ?? null,
    },
    // No proposal means no proposed years, which is already null by the rule
    // above rather than by a second check here.
    lifetimeTax: { base: lifetimeTax(baseYears), proposed: lifetimeTax(proposedYears) },
    cover,
    // The CURRENT plan's, and the fact's label says so. The chapter needs no
    // proposal and the arc makes no Medicare comparison; what a proposal does to
    // the surcharge lands in the tax chapter, which states both plans.
    medicare: medicareTotals(baseYears),
    // The BASE plan's setting, even on a deck carrying a proposal. A scenario
    // can override it, and a chapter that stated the proposal's rate would be
    // telling the client what we assume about prices in a plan they have not
    // agreed to — while every other figure in the report is still built on
    // both. The same call chapter 11 makes about Medicare, for the same reason.
    inflationRate: base.effectiveTree.planSettings.inflationRate,
    flow: firstYear
      ? {
          income: firstYear.totalIncome,
          spending: firstYear.expenses.total,
          saving: firstYear.totalExpenses - firstYear.expenses.total,
        }
      : null,
    charts,
  });

  return {
    household: { firstNames, householdName },
    scenarioLabel: args.scenarioLabel,
    documentRole: args.documentRole,
    hasProposal: proposedRef != null,
    strategies,
    goals,
    facts,
    charts,
    nextSteps,
  };
}
