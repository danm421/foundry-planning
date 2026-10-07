// Which reports a plan earns, and why — one table of plain conditions over
// `PlanFacts`.
//
// Every rule returns a score out of 100 and the one sentence an advisor reads
// beside the suggestion, so the reason is always the condition that fired, in
// the plan's own numbers. A page may carry several rules; its best match wins.
// Scores are relative, not probabilities: a plan-specific trigger (conversions
// on file, estate tax projected, a debt to weigh) sits in the 70s–90s, a
// life-stage fit in the 40s–80s, and the always-useful core pages sit low in
// the 10s–40s so they surface only when nothing sharper does — which is what
// keeps four suggestions on screen for every plan.
//
// Cover, Contents and Blank Page are never suggested: they frame a deck, they
// don't answer anything about this plan.
import type { PresentationPageId } from "@/components/presentations/registry";
import type { PlanFacts, ScenarioSummary } from "./plan-facts";
import { CONVERSION_YEARS, orderingPatch, scenarioMatches, type ScenarioTopic } from "./scenario-rules";
import { conversionBracketReason, conversionSpan, listPhrase, money, plural, rate, yearsAway } from "./reason-text";

export interface ReportSuggestion {
  pageId: PresentationPageId;
  score: number;
  reason: string;
  /** Merged over the page's default options when the advisor adds it, so a
   *  suggestion born from "scenario X adds conversions" arrives pointed at X. */
  optionsPatch?: Record<string, unknown>;
  /** Set when the chosen scenario's own changes earned the card. Such cards
   *  rank above every plan card. */
  changeType?: ScenarioTopic;
}

export type Match = Omit<ReportSuggestion, "pageId" | "changeType">;
type Rule = (f: PlanFacts) => Match | null | false | undefined;

function isYoung(f: PlanFacts): boolean {
  return f.youngestAge != null && f.youngestAge < 40 && !f.allRetired;
}

/** Retirement within this many years is "close" for the retirement pages. */
const NEAR_RETIREMENT = 15;
function nearRetirement(f: PlanFacts): boolean {
  return f.yearsToRetirement != null && f.yearsToRetirement > 0 && f.yearsToRetirement <= NEAR_RETIREMENT;
}

/** "Family Trust" for one, "3 trusts and businesses" for several. */
function entitiesPhrase(f: PlanFacts): string {
  const all = [...f.trusts, ...f.businesses];
  return all.length === 1 ? all[0].name : `${all.length} trusts and businesses`;
}

/** The scenario whose conversions the Roth pages show: the chosen plan when
 *  it converts, else the first scenario that does. A chosen plan whose own
 *  projection converts nothing (a switched-off conversion) shows none. */
function rothScenario(f: PlanFacts): ScenarioSummary | undefined {
  const converting = f.scenarios.filter(
    (s) => s.hasRothConversion && !(s.id === f.planRef && (!f.projected || f.projected.rothConverted === 0)),
  );
  return converting.find((s) => s.id === f.planRef) ?? converting[0];
}

function entityCount(f: PlanFacts): number {
  return f.trusts.length + f.businesses.length;
}

/** The plan a single-plan page should read: the chosen plan when it is Base
 *  Case or a live scenario. A snapshot can't be a page's own plan, so the
 *  page keeps its default. */
function ownPlanPatch(f: PlanFacts): Record<string, unknown> | undefined {
  return f.planRef.startsWith("snap:") ? undefined : { scenarioId: f.planRef };
}

function comparableScenarios(f: PlanFacts): ScenarioSummary[] {
  return f.scenarios.filter((s) => s.changeCount > 0);
}

const TIDBIT_TOPICS: Record<string, string> = {
  "debt-avalanche-snowball": "paying down debt",
  "taxes-roth-vs-traditional": "Roth vs traditional",
  "match-is-not-a-bonus": "the employer match",
  "compounding-rule-of-72": "the rule of 72",
};

/** Things Worth Knowing prints nothing without notes, so it arrives with the
 *  ones this plan earns. */
function pickTidbits(f: PlanFacts): string[] {
  const picks = [
    f.topDebt && "debt-avalanche-snowball",
    f.roth === 0 && "taxes-roth-vs-traditional",
    f.projected?.employerMatch && "match-is-not-a-bonus",
  ].filter((x): x is string => typeof x === "string");
  return picks.length > 0 ? picks : ["compounding-rule-of-72"];
}

const RULES: Partial<Record<PresentationPageId, Rule[]>> = {
  // ── Framing ────────────────────────────────────────────────────────────────
  clientProfile: [
    (f) => f.minorChildren > 0 && {
      score: 36,
      reason: `Introduces the family — ${plural(f.minorChildren, "child", "children")} under 18 — before the numbers.`,
    },
    () => ({ score: 30, reason: "Introduces the household before the numbers." }),
  ],
  observationsNextSteps: [
    (f) => f.observationCount > 0 && {
      score: 72,
      reason: `${f.observationCount} ${f.observationCount === 1 ? "observation or next step" : "observations and next steps"} written up and ready to present.`,
    },
  ],
  planStory: [
    (f) => f.storyChapterCount > 0 && {
      score: 66,
      reason: "Plan Story chapters are already drafted for this household.",
      optionsPatch: f.scenario ? { scenarioId: f.scenario.id } : undefined,
    },
  ],
  mapGoals: [
    (f) => f.goalCount > 0 && {
      score: 48,
      reason: f.goalCount === 1
        ? "Puts the goal and retirement on one timeline."
        : `Puts ${f.goalCount} goals and retirement on one timeline.`,
    },
    (f) => nearRetirement(f) && {
      score: 34,
      reason: "Retirement, Social Security and life expectancy on one timeline.",
    },
  ],
  mapNetWorth: [
    (f) => entityCount(f) > 0 && {
      score: 46,
      reason: `Shows who owns what, including ${entitiesPhrase(f)}.`,
    },
    (f) => f.married && { score: 24, reason: "Shows what each co-client owns, and what they own together." },
  ],
  mapCashFlow: [() => ({ score: 16, reason: "Income, savings and spending by owner." })],
  assumptions: [
    (f) => f.stressItems.length > 0 && {
      score: 55,
      reason: `Spells out the stress test the plan runs under: ${listPhrase(f.stressItems)}.`,
    },
    () => ({ score: 16, reason: "Documents the growth, inflation and tax assumptions behind every figure." }),
  ],

  // ── Cash Flow ──────────────────────────────────────────────────────────────
  cashFlow: [
    (f) => f.projected?.depletionYear != null && {
      score: 82,
      reason: `The portfolio runs out in ${f.projected.depletionYear} — this shows the years leading there.`,
    },
    () => ({ score: 36, reason: "The year-by-year view every other page draws on." }),
  ],
  cashFlowWithdrawals: [
    (f) => {
      const start = f.projected?.withdrawalFirstYear;
      if (start == null || start - f.currentYear > 10) return null;
      const whileWorking = !f.allRetired && start <= f.currentYear + 1;
      return {
        score: whileWorking ? 64 : 58,
        reason: whileWorking
          ? "The plan already draws on the portfolio before retirement — this shows how much, each year."
          : `The plan starts drawing on the portfolio in ${start}.`,
      };
    },
  ],
  cashFlowMonthly: [
    (f) => f.allRetired && { score: 44, reason: "What the household lives on each month in retirement." },
    (f) => f.yearsToRetirement != null && f.yearsToRetirement > 0 && f.yearsToRetirement <= 3 && {
      score: 42,
      reason: `Retirement is ${yearsAway(f.yearsToRetirement)} — this shows the monthly paycheck that replaces the salary.`,
    },
  ],
  cashFlowGrowth: [
    (f) => f.liquidPortfolio >= 1_000_000 && {
      score: 22,
      reason: `What the ${money(f.liquidPortfolio)} portfolio earns each year, by asset type.`,
    },
  ],
  cashFlowActivity: [
    (f) => {
      const start = f.projected?.withdrawalFirstYear;
      return f.annualSavings > 0 && start != null && start > f.currentYear && start - f.currentYear <= 15 && {
        score: 28,
        reason: `Shows the turn from adding to the portfolio to drawing on it, in ${start}.`,
      };
    },
  ],
  cashFlowSavings: [
    (f) => f.annualSavings > 0 && !f.allRetired && {
      score: 32,
      reason: `Lays out ${money(f.annualSavings)} a year of savings, account by account.`,
    },
  ],
  cashFlowIncome: [() => ({ score: 20, reason: "Income by source across the plan." })],
  cashFlowExpenses: [() => ({ score: 18, reason: "Spending by category across the plan." })],
  cashFlowNet: [() => ({ score: 10, reason: "Where each year's shortfall is drawn from, and the withdrawal rate." })],
  cashFlowAssets: [() => ({ score: 10, reason: "Year-end balances by asset type." })],
  entityCashFlow: [
    (f) => f.businesses[0] && {
      score: 56,
      reason: `Follows the cash through ${f.businesses[0].name}.`,
      optionsPatch: { entityId: f.businesses[0].id, entityName: f.businesses[0].name },
    },
    (f) => f.trusts[0] && {
      score: 40,
      reason: `Follows the cash through ${f.trusts[0].name}.`,
      optionsPatch: { entityId: f.trusts[0].id, entityName: f.trusts[0].name },
    },
  ],

  // ── Income Tax ─────────────────────────────────────────────────────────────
  rothConversion: [
    (f) => f.projected && f.projected.rothConverted > 0 && {
      score: 96,
      reason: `This plan converts ${money(f.projected.rothConverted)} to Roth${conversionSpan(f.projected)}.`,
      optionsPatch: ownPlanPatch(f),
    },
    (f) => {
      const s = rothScenario(f);
      return s && {
        score: 84,
        reason: `“${s.name}” adds Roth conversions — this shows what they cost and what they save.`,
        optionsPatch: { scenarioId: s.id },
      };
    },
  ],
  taxSummary: [
    (f) => f.preTax >= 500_000 && {
      score: 52,
      reason: `${money(f.preTax)} sits in pre-tax accounts — every dollar out is taxed as income.`,
    },
    (f) => f.salaryIncome >= 250_000 && {
      score: 46,
      reason: `${money(f.salaryIncome)} of pay a year puts bracket management in play.`,
    },
    () => ({ score: 30, reason: "Lifetime federal, state and capital-gains taxes on one page." }),
  ],
  taxComparison: [
    // A chosen scenario's own tax story is the scenario tier's (scenario-rules.ts).
    (f) => {
      const s = rothScenario(f);
      return !f.scenario && s && {
        score: 70,
        reason: `The tax the conversions in “${s.name}” add now and save later, against Base Case.`,
        optionsPatch: { scenarioId: s.id },
      };
    },
  ],
  incomeTaxBracketFederal: [
    (f) => f.bracketMode && f.projected && f.projected.rothConverted > 0 && {
      score: 88,
      reason: conversionBracketReason(f.projected),
      optionsPatch: CONVERSION_YEARS,
    },
    (f) => f.bracketMode && f.projected && f.projected.bracketEdgeYears >= 3 && f.preTax >= 500_000 && {
      score: 50,
      reason: `${f.projected.bracketEdgeYears} years sit within $10k of the next federal bracket — room to plan around.`,
    },
    (f) => f.bracketMode && (f.salaryIncome >= 200_000 || f.preTax >= 1_000_000) && {
      score: 26,
      reason: "How close each year runs to the next federal bracket.",
    },
  ],
  incomeTaxBracketState: [
    (f) => f.bracketMode && f.projected && f.projected.lifetimeTax.state > 0 && f.projected.rothConverted > 0 && {
      score: 60,
      reason: "The conversions show up in state tax too — this shows each year's state bracket.",
      optionsPatch: CONVERSION_YEARS,
    },
  ],
  incomeTaxFederal: [
    (f) => f.projected && f.projected.rothConverted > 0 && {
      score: 56,
      reason: "Federal tax line by line in the conversion years.",
      optionsPatch: CONVERSION_YEARS,
    },
    (f) => f.projected && f.projected.amtOrNiitYears >= 3 && {
      score: 44,
      reason: `${f.projected.amtOrNiitYears} years pay AMT or the 3.8% investment tax — federal tax line by line.`,
    },
  ],
  incomeTaxState: [
    (f) => f.projected && f.projected.lifetimeTax.state >= 100_000 && {
      score: 30,
      reason: `${money(f.projected.lifetimeTax.state)} of state income tax over the plan, line by line.`,
    },
  ],
  incomeTaxIncome: [
    (f) => f.projected?.bigGain && {
      score: 36,
      reason: `A ${money(f.projected.bigGain.gain)} capital gain in ${f.projected.bigGain.year} — that year's income, source by source.`,
    },
  ],
  incomeTaxBelowLine: [
    (f) => f.projected && f.projected.itemizingYears >= 3 && {
      score: 28,
      reason: `The plan itemizes in ${f.projected.itemizingYears} years — what it deducts, against the standard deduction.`,
    },
  ],
  incomeTaxOtherTaxes: [
    (f) => {
      const p = f.projected;
      if (!p) return null;
      if (p.amtOrNiitYears >= 3) {
        return { score: 30, reason: `${p.amtOrNiitYears} years pay AMT or the 3.8% investment tax on top of regular tax.` };
      }
      return p.lifetimeTax.capitalGains >= 25_000 && {
        score: 30,
        reason: `${money(p.lifetimeTax.capitalGains)} of capital-gains tax over the plan, year by year.`,
      };
    },
  ],

  // ── Assets ─────────────────────────────────────────────────────────────────
  balanceSheet: [
    (f) => f.netWorth >= 1_000_000 && { score: 44, reason: `Net worth of ${money(f.netWorth)}, asset by asset.` },
    () => ({ score: 40, reason: "Net worth, assets and debts as of today." }),
  ],
  entitiesBalanceSheet: [
    (f) => entityCount(f) > 0 && {
      score: 50,
      reason: entityCount(f) === 1
        ? `Assets, debts and net worth for ${entitiesPhrase(f)}.`
        : `A balance sheet for each of ${entitiesPhrase(f)}.`,
    },
  ],
  investmentProposal: [
    (f) => f.proposals[0] && {
      score: 78,
      reason: `Proposal “${f.proposals[0].name}” is saved and ready to present.`,
      optionsPatch: { proposalId: f.proposals[0].id },
    },
  ],
  holdings: [
    (f) => f.hasHoldings && { score: 42, reason: "Position-by-position detail for the accounts with holdings on file." },
  ],
  assetAllocation: [
    (f) => f.hasHoldings && { score: 38, reason: "Today's mix against a target, class by class." },
    (f) => f.liquidPortfolio >= 100_000 && { score: 30, reason: `How the ${money(f.liquidPortfolio)} portfolio is invested.` },
  ],
  portfolioAnalysis: [
    // The page charts portfolios and asset classes, not holdings.
    (f) => f.liquidPortfolio >= 250_000 && { score: 26, reason: "Risk and return of each portfolio on one chart." },
  ],

  // ── Insurance ──────────────────────────────────────────────────────────────
  lifeInsuranceSummary: [
    (f) => f.minorChildren > 0 && f.salaryIncome > 0 && !f.allRetired && {
      score: 74,
      reason: `${plural(f.minorChildren, "child", "children")} under 18 ${f.minorChildren === 1 ? "depends" : "depend"} on ${money(f.salaryIncome)} of pay — this tests the coverage.`,
    },
    (f) => f.lifePolicyCount > 0 && {
      score: 56,
      reason:
        `${plural(f.lifePolicyCount, "policy", "policies")}` +
        (f.lifeFaceValue > 0 ? ` with ${money(f.lifeFaceValue)} of death benefit` : "") +
        " — coverage against need, and who receives it.",
    },
    (f) => f.married && f.salaryIncome > 0 && !f.allRetired && {
      score: 44,
      reason: "Tests whether the survivor's income holds up.",
    },
  ],

  // ── Estate ─────────────────────────────────────────────────────────────────
  estateSummary: [
    (f) => f.projected && f.projected.estateTax > 0 && {
      score: 86,
      reason: `The plan projects ${money(f.projected.estateTax)} in estate tax.`,
      optionsPatch: orderingPatch(f.projected),
    },
    (f) => (f.trusts.length > 0 || f.willCount > 0) && {
      score: 52,
      reason: f.trusts.length > 0
        ? `How ${plural(f.trusts.length, "trust")} and the wills divide the estate.`
        : "How the wills divide the estate.",
      optionsPatch: orderingPatch(f.projected),
    },
    (f) => f.projected && f.projected.grossEstate >= 5_000_000 && {
      score: 48,
      reason: `A ${money(f.projected.grossEstate)} estate — who receives what, and when.`,
      optionsPatch: orderingPatch(f.projected),
    },
    (f) => ({ score: 18, reason: "Who receives what, and what it costs to get it there.", optionsPatch: orderingPatch(f.projected) }),
  ],
  estateFlowChart: [
    (f) => f.projected && f.projected.estateTax > 0 && {
      score: 68,
      reason: "Follows the estate through each death to the heirs, the trusts and the IRS.",
      optionsPatch: orderingPatch(f.projected),
    },
    (f) => f.trusts.length > 0 && {
      score: 60,
      reason: "Shows what reaches the heirs outright and what passes through trust.",
      optionsPatch: orderingPatch(f.projected),
    },
  ],
  estateFlow: [
    (f) => f.willCount > 0 && {
      score: 46,
      reason: "Spells out the wills: transfers at the first death, then the final distribution.",
      optionsPatch: orderingPatch(f.projected),
    },
  ],
  estateTransfer: [
    (f) => f.projected && f.projected.estateTax > 0 && {
      score: 58,
      reason: "Year by year: what the heirs would keep if death came that year.",
    },
  ],
  estateLiquidity: [
    (f) => {
      const p = f.projected;
      if (!p || p.estateTax <= 0) return null;
      const illiquid = f.netWorth > 0 ? (f.realEstate + f.business) / f.netWorth : 0;
      return illiquid >= 0.4
        ? {
            score: 84,
            reason: `${money(p.estateTax)} of estate tax on an estate that is ${Math.round(illiquid * 100)}% property and business — can it be paid without a forced sale?`,
          }
        : { score: 62, reason: `Checks there is cash or insurance to pay ${money(p.estateTax)} of estate tax.` };
    },
  ],
  estateGiftTax: [
    (f) => f.giftCount > 0 && {
      score: 80,
      reason: `${plural(f.giftCount, "lifetime gift")} on file — the exemption they use, year by year.`,
    },
  ],

  // ── Monte Carlo ────────────────────────────────────────────────────────────
  monteCarlo: [
    (f) => f.projected?.depletionYear != null && {
      score: 70,
      reason: `The plan runs out in ${f.projected.depletionYear} on average returns — this shows the odds across a thousand markets.`,
      optionsPatch: { highlight: "longevity" },
    },
    (f) => nearRetirement(f) && {
      score: 54,
      reason: `Retirement is ${yearsAway(f.yearsToRetirement!)} — how sure is the plan?`,
    },
    (f) => f.allRetired && { score: 50, reason: "How the plan holds up through bad markets in retirement." },
    () => ({ score: 28, reason: "The plan's odds across a thousand markets." }),
  ],

  // ── Comparison ─────────────────────────────────────────────────────────────
  retirementComparison: [
    (f) => {
      const s = !f.scenario && comparableScenarios(f)[0];
      return s && {
        score: 50,
        reason: `Does “${s.name}” beat Base Case for retirement?`,
        optionsPatch: { scenarioId: s.id },
      };
    },
  ],
  scenarioChanges: [
    (f) => {
      const s = !f.scenario && comparableScenarios(f)[0];
      return s && {
        score: 40,
        reason: s.changeCount === 1
          ? `The one change “${s.name}” makes, in plain words.`
          : `The ${s.changeCount} changes “${s.name}” makes, in plain words.`,
        optionsPatch: { scenarioId: s.id },
      };
    },
  ],
  scenarioComparison: [
    (f) => {
      const live = comparableScenarios(f);
      return live.length >= 2 && {
        score: 58,
        reason: `${plural(live.length, "scenario")} to weigh against Base Case, side by side.`,
        optionsPatch: { scenarioIds: live.slice(0, 3).map((s) => s.id) },
      };
    },
  ],

  // ── Retirement ─────────────────────────────────────────────────────────────
  retirementSummary: [
    (f) => nearRetirement(f) && { score: 82, reason: `Retirement is ${yearsAway(f.yearsToRetirement!)}.` },
    (f) => f.allRetired && { score: 64, reason: "What funds each year of retirement, and how long it lasts." },
    (f) => f.yearsToRetirement != null && f.yearsToRetirement > NEAR_RETIREMENT && f.yearsToRetirement <= 25 && {
      score: 46,
      reason: `Retirement is ${f.yearsToRetirement} years out — where the savings are heading.`,
    },
    () => ({ score: 22, reason: "Where the plan stands for retirement." }),
  ],
  medicareSummary: [
    // A surcharge decades out is real but not this meeting's topic, so the
    // score falls with distance; the reason still names it.
    (f) => f.projected && f.projected.irmaaTotal > 0 && {
      score: f.projected.irmaaFirstYear! - f.currentYear <= 10 ? 90 : 38,
      reason: `The plan pays ${money(f.projected.irmaaTotal)} in Medicare income surcharges (IRMAA), starting ${f.projected.irmaaFirstYear}.`,
    },
    (f) => f.medicareYear != null && f.medicareYear - f.currentYear <= 5 && {
      score: 66,
      reason: f.medicareYear <= f.currentYear
        ? "Medicare premiums and surcharges, year by year."
        : `Medicare starts in ${f.medicareYear} — premiums and surcharges for life.`,
    },
  ],

  // ── Early Years ────────────────────────────────────────────────────────────
  earlyYearsDebtOrInvest: [
    (f) => f.topDebt && !f.allRetired && (isYoung(f) || f.topDebt.interestRate >= 0.06) && {
      score: isYoung(f) ? 88 : 54,
      reason: `${money(f.topDebt.balance)} on ${f.topDebt.name} at ${rate(f.topDebt.interestRate)} — pay it down, or invest?`,
      optionsPatch: { liabilityId: f.topDebt.id },
    },
  ],
  earlyYearsStanding: [
    (f) => isYoung(f) && {
      score: f.youngestAge! <= 35 ? 86 : 80,
      reason: `${f.clientFirstName} is ${f.clientAge ?? f.youngestAge} — where the savings stand today, and what the match adds.`,
      optionsPatch: f.projected && !f.projected.employerMatch ? { showMatchLine: false } : undefined,
    },
  ],
  earlyYearsHumanCapital: [
    (f) => isYoung(f) && f.salaryIncome > 0 && {
      score: 78,
      reason: `${money(f.salaryIncome)} a year of pay is the biggest asset this household has.`,
    },
  ],
  earlyYearsLadder: [
    // Without a living expense that spends the leftover, raising the savings
    // rate only moves dollars the plan already invests and the bars read flat
    // (see `flat-ladder-gate.ts`) — still a fit, just not a strong one.
    (f) => isYoung(f) && f.annualSavings > 0 && f.hasMovableDeferral && {
      score: f.absorbsSurplus ? 76 : 50,
      reason: "What each extra point of savings is worth by retirement.",
    },
  ],
  earlyYearsWaiting: [
    (f) => isYoung(f) && f.hasMovableDeferral && {
      score: 72,
      reason: `At ${f.youngestAge}, every year of waiting costs the most — this puts a number on it.`,
    },
  ],
  earlyYearsRoth: [
    (f) => isYoung(f) && f.salaryIncome > 0 && f.bracketMode && f.hasMovableDeferral && {
      score: f.roth === 0 ? 70 : 62,
      reason: f.roth === 0
        ? "Nothing in Roth yet — weighs Roth against traditional while the bracket is low."
        : "Weighs Roth against traditional deferrals while the bracket is low.",
    },
  ],
  earlyYearsTidbits: [
    (f) => {
      if (!isYoung(f)) return null;
      const tidbits = pickTidbits(f);
      return {
        score: 40,
        reason: `Short notes picked for this plan: ${listPhrase(tidbits.map((id) => TIDBIT_TOPICS[id]))}.`,
        optionsPatch: { tidbits },
      };
    },
  ],
};

/** Cards a scenario's own changes earned (2), then its generic any-change
 *  cards — Plan Changes and the fallback verdict (1) — then plan cards (0).
 *  The any-change pair is the fallback the spec's per-type table ends on
 *  ("Plan length → … · Retirement Comparison (any change)"), so it never
 *  outranks a change type's own page. */
const tier = (s: ReportSuggestion) => (!s.changeType ? 0 : s.changeType === "anyChange" ? 1 : 2);
/** Positive when `a` outranks `b`: higher tier first, then higher score. */
const outranks = (
  a: ReportSuggestion,
  b: ReportSuggestion,
  scoreOf: (s: ReportSuggestion) => number = (s) => s.score,
) => tier(a) - tier(b) || scoreOf(a) - scoreOf(b);

/** Every report this plan earns, best first: the chosen scenario's own pages,
 *  then the plan's. One card per page — its best match, a scenario match
 *  beating any plan match. A tie keeps whichever card the Map met first: the
 *  tables' order, except that a scenario card replacing a plan card keeps the
 *  plan card's place. */
export function scoreReports(facts: PlanFacts): ReportSuggestion[] {
  const best = new Map<PresentationPageId, ReportSuggestion>();
  const offer = (s: ReportSuggestion) => {
    const cur = best.get(s.pageId);
    if (!cur || outranks(s, cur) > 0) best.set(s.pageId, s);
  };
  for (const [pageId, rules] of Object.entries(RULES) as Array<[PresentationPageId, Rule[]]>) {
    for (const rule of rules) {
      const m = rule(facts);
      if (m) offer({ pageId, ...m });
    }
  }
  for (const s of scenarioMatches(facts)) offer(s);
  return [...best.values()].sort((a, b) => outranks(b, a));
}

/** Each further pick from a category already on screen costs this much, so
 *  four early-years sheets don't crowd out the one estate page that matters. */
const SAME_GROUP_PENALTY = 14;
/** A change type's first two cards are its core story — Roth Conversion and
 *  Tax Bracket, Retirement Summary and the verdict — so only the third on
 *  costs anything. Real scenarios mix several changes (Cooper & Susan's
 *  "New Plan" makes 11 across 9 types); one free card would push the second
 *  Roth page below four other changes' firsts. */
const FREE_PER_CHANGE = 2;

/**
 * The `count` suggestions to show, skipping pages already in the deck. Cards
 * the chosen scenario's changes earned come first. Among them, a change
 * type's third card costs SAME_GROUP_PENALTY, its fourth twice that, and so
 * on (the first two cards are free); among plan cards, each card already
 * shown from the same category costs it. Re-run on every deck change, so
 * adding one promotes the next-best into its slot.
 */
export function pickSuggestions(
  all: readonly ReportSuggestion[],
  inDeck: ReadonlySet<string>,
  categoryOf: (pageId: PresentationPageId) => string,
  count = 4,
): ReportSuggestion[] {
  const pool = all.filter((s) => !inDeck.has(s.pageId));
  const picked: ReportSuggestion[] = [];
  const byCategory = new Map<string, number>();
  const byChange = new Map<string, number>();
  const adjusted = (s: ReportSuggestion) =>
    s.changeType
      ? s.score - SAME_GROUP_PENALTY * Math.max(0, (byChange.get(s.changeType) ?? 0) - (FREE_PER_CHANGE - 1))
      : s.score - SAME_GROUP_PENALTY * (byCategory.get(categoryOf(s.pageId)) ?? 0);
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  while (picked.length < count && pool.length > 0) {
    let bestIdx = 0;
    pool.forEach((s, i) => {
      const lead = pool[bestIdx];
      if (outranks(s, lead, adjusted) > 0) bestIdx = i;
    });
    const [next] = pool.splice(bestIdx, 1);
    picked.push(next);
    bump(byCategory, categoryOf(next.pageId));
    if (next.changeType) bump(byChange, next.changeType);
  }
  return picked;
}

/**
 * Lays `next` out so a card that is still suggested keeps the slot it was in,
 * and a newcomer takes a slot that emptied — adding one card swaps that one
 * card, instead of shuffling the four under the advisor's pointer.
 */
export function keepSlots(
  previous: readonly PresentationPageId[],
  next: readonly ReportSuggestion[],
): ReportSuggestion[] {
  const byId = new Map(next.map((s) => [s.pageId, s]));
  const slots: Array<ReportSuggestion | undefined> = previous.map((id) => byId.get(id));
  const placed = new Set(slots.filter(Boolean).map((s) => s!.pageId));
  const newcomers = next.filter((s) => !placed.has(s.pageId));
  const filled = slots.map((s) => s ?? newcomers.shift());
  return [...filled, ...newcomers].filter((s): s is ReportSuggestion => s != null);
}

/** Pages nearly every plan presentation carries. */
export const ESSENTIAL_PAGES: readonly PresentationPageId[] = ["balanceSheet", "clientProfile", "retirementSummary"];
const COMPARISON_PAGES = new Set<string>(["retirementComparison", "taxComparison", "scenarioComparison", "scenarioChanges"]);

export interface DeckPage {
  pageId: PresentationPageId;
  options: unknown;
}

function pointsAt(options: unknown, plan: string): boolean {
  const o = (options ?? {}) as { scenarioId?: unknown; scenarioIds?: unknown };
  return o.scenarioId === plan || (Array.isArray(o.scenarioIds) && o.scenarioIds.includes(plan));
}

/**
 * The "Missing from this deck" row: the essentials not in the deck and not
 * already on a card. For a chosen scenario that changes something, also the
 * comparison page that fits it best (Tax or Retirement Comparison, pointed
 * at it) — unless the deck already compares against this scenario.
 */
export function missingEssentials(
  all: readonly ReportSuggestion[],
  deck: readonly DeckPage[],
  plan: string,
  onCards: ReadonlySet<string>,
): ReportSuggestion[] {
  const inDeck = new Set<string>(deck.map((p) => p.pageId));
  const out = ESSENTIAL_PAGES.filter((id) => !inDeck.has(id) && !onCards.has(id)).flatMap(
    (id) => all.find((s) => s.pageId === id) ?? [],
  );
  const [comparison] = all
    .filter((s) => (s.pageId === "taxComparison" || s.pageId === "retirementComparison") && pointsAt(s.optionsPatch, plan))
    .sort((a, b) => b.score - a.score);
  const compared = deck.some((p) => COMPARISON_PAGES.has(p.pageId) && pointsAt(p.options, plan));
  if (comparison && !compared && !onCards.has(comparison.pageId)) out.push(comparison);
  return out;
}
