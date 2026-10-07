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
import { compactCurrency as money, percentLabel } from "@/lib/presentations/format";
import type { PlanFacts, ScenarioSummary } from "./plan-facts";

export interface ReportSuggestion {
  pageId: PresentationPageId;
  score: number;
  reason: string;
  /** Merged over the page's default options when the advisor adds it, so a
   *  suggestion born from "scenario X adds conversions" arrives pointed at X. */
  optionsPatch?: Record<string, unknown>;
}

type Match = Omit<ReportSuggestion, "pageId">;
type Rule = (f: PlanFacts) => Match | null | false | undefined;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

function yearsAway(n: number): string {
  return n === 1 ? "a year away" : `${n} years away`;
}

/** The chosen plan is a live scenario — not Base Case, not a frozen snapshot. */
function planIsScenario(f: PlanFacts): boolean {
  return f.planRef !== "base" && !f.planRef.startsWith("snap:");
}

/** The first scenario that adds Roth conversions — what the Roth pages compare. */
function rothScenario(f: PlanFacts): ScenarioSummary | undefined {
  return f.scenarios.find((s) => s.addsRothConversion);
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

/** The chosen plan when it is a scenario with changes, else the first
 *  scenario that has any — the comparison pages' natural subject. */
function comparisonSubject(f: PlanFacts): { scenario: ScenarioSummary; isChosenPlan: boolean } | null {
  const chosen = planIsScenario(f) ? f.scenarios.find((s) => s.id === f.planRef) : undefined;
  if (chosen && chosen.changeCount > 0) return { scenario: chosen, isChosenPlan: true };
  const first = comparableScenarios(f)[0];
  return first ? { scenario: first, isChosenPlan: false } : null;
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
      reason: `${plural(f.observationCount, "observation")} written up and ready to present.`,
    },
  ],
  planStory: [
    (f) => f.storyChapterCount > 0 && {
      score: 66,
      reason: "Plan Story chapters are already drafted for this household.",
    },
  ],
  mapGoals: [
    (f) => f.educationGoals > 0 && {
      score: 48,
      reason: f.educationGoals === 1
        ? "Puts the education goal and retirement on one timeline."
        : `Puts ${f.educationGoals} education goals and retirement on one timeline.`,
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
  assumptions: [() => ({ score: 16, reason: "Documents the growth, inflation and tax assumptions behind every figure." })],

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
      reason:
        `This plan converts ${money(f.projected.rothConverted)} to Roth` +
        (f.projected.rothFirstYear === f.projected.rothLastYear
          ? ` in ${f.projected.rothFirstYear}.`
          : `, ${f.projected.rothFirstYear}–${f.projected.rothLastYear}.`),
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
    (f) => {
      const s = rothScenario(f);
      return s && {
        score: 70,
        reason: `The tax the conversions in “${s.name}” add now and save later, against Base Case.`,
        optionsPatch: { scenarioId: s.id },
      };
    },
    (f) => {
      const subject = comparisonSubject(f);
      return subject?.isChosenPlan && {
        score: 50,
        reason: `Lifetime taxes under “${subject.scenario.name}” against Base Case.`,
        optionsPatch: { scenarioId: subject.scenario.id },
      };
    },
  ],
  incomeTaxBracketFederal: [
    (f) => (f.salaryIncome >= 200_000 || f.preTax >= 1_000_000) && {
      score: 26,
      reason: "How close each year runs to the next federal bracket.",
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
    (f) => f.hasHoldings && { score: 26, reason: "Risk and return of each portfolio on one chart." },
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
    },
    (f) => (f.trusts.length > 0 || f.willCount > 0) && {
      score: 52,
      reason: f.trusts.length > 0
        ? `How ${plural(f.trusts.length, "trust")} and the wills divide the estate.`
        : "How the wills divide the estate.",
    },
    (f) => f.projected && f.projected.grossEstate >= 5_000_000 && {
      score: 48,
      reason: `A ${money(f.projected.grossEstate)} estate — who receives what, and when.`,
    },
    () => ({ score: 18, reason: "Who receives what, and what it costs to get it there." }),
  ],
  estateFlowChart: [
    (f) => f.projected && f.projected.estateTax > 0 && {
      score: 68,
      reason: "Follows the estate through each death to the heirs, the trusts and the IRS.",
    },
    (f) => f.trusts.length > 0 && {
      score: 60,
      reason: "Shows what reaches the heirs outright and what passes through trust.",
    },
  ],
  estateFlow: [
    (f) => f.willCount > 0 && {
      score: 46,
      reason: "Spells out the wills: transfers at the first death, then the final distribution.",
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
      const subject = comparisonSubject(f);
      if (!subject) return null;
      return {
        score: subject.isChosenPlan ? 72 : 50,
        reason: `Does “${subject.scenario.name}” beat Base Case for retirement?`,
        optionsPatch: { scenarioId: subject.scenario.id },
      };
    },
  ],
  scenarioChanges: [
    (f) => {
      const subject = comparisonSubject(f);
      if (!subject) return null;
      return {
        score: subject.isChosenPlan ? 64 : 40,
        reason: subject.scenario.changeCount === 1
          ? `The one change “${subject.scenario.name}” makes, in plain words.`
          : `The ${subject.scenario.changeCount} changes “${subject.scenario.name}” makes, in plain words.`,
        optionsPatch: { scenarioId: subject.scenario.id },
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
      reason: `${money(f.topDebt.balance)} on ${f.topDebt.name} at ${percentLabel(f.topDebt.interestRate)} — pay it down, or invest?`,
      optionsPatch: { liabilityId: f.topDebt.id },
    },
  ],
  earlyYearsStanding: [
    (f) => isYoung(f) && {
      score: f.youngestAge! <= 35 ? 86 : 80,
      reason: `${f.clientFirstName} is ${f.clientAge ?? f.youngestAge} — where the savings stand today, and what the match adds.`,
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
    (f) => isYoung(f) && f.annualSavings > 0 && {
      score: f.absorbsSurplus ? 76 : 50,
      reason: "What each extra point of savings is worth by retirement.",
    },
  ],
  earlyYearsWaiting: [
    (f) => isYoung(f) && {
      score: 72,
      reason: `At ${f.youngestAge}, every year of waiting costs the most — this puts a number on it.`,
    },
  ],
  earlyYearsRoth: [
    (f) => isYoung(f) && f.salaryIncome > 0 && {
      score: f.roth === 0 ? 70 : 62,
      reason: f.roth === 0
        ? "Nothing in Roth yet — weighs Roth against traditional while the bracket is low."
        : "Weighs Roth against traditional deferrals while the bracket is low.",
    },
  ],
  earlyYearsTidbits: [
    (f) => isYoung(f) && { score: 40, reason: "Short notes on the habits that compound early." },
  ],
};

/** Every report this plan earns, best first. Ties keep the table's order. */
export function scoreReports(facts: PlanFacts): ReportSuggestion[] {
  const out: ReportSuggestion[] = [];
  for (const [pageId, rules] of Object.entries(RULES) as Array<[PresentationPageId, Rule[]]>) {
    let best: Match | null = null;
    for (const rule of rules) {
      const m = rule(facts);
      if (m && (!best || m.score > best.score)) best = m;
    }
    if (best) out.push({ pageId, ...best });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Each further pick from a category already on screen costs this much, so
 *  four early-years sheets don't crowd out the one estate page that matters —
 *  while a category that genuinely dominates (a 30-year-old's plan) still
 *  wins most slots. */
const SAME_CATEGORY_PENALTY = 14;

/**
 * The `count` suggestions to show: best adjusted score first, skipping pages
 * already in the deck. Re-run on every deck change, so adding one promotes the
 * next-best match into its slot.
 */
export function pickSuggestions(
  all: readonly ReportSuggestion[],
  inDeck: ReadonlySet<string>,
  categoryOf: (pageId: PresentationPageId) => string,
  count = 4,
): ReportSuggestion[] {
  const pool = all.filter((s) => !inDeck.has(s.pageId));
  const picked: ReportSuggestion[] = [];
  const shown = new Map<string, number>();
  while (picked.length < count && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    pool.forEach((s, i) => {
      const adjusted = s.score - SAME_CATEGORY_PENALTY * (shown.get(categoryOf(s.pageId)) ?? 0);
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIdx = i;
      }
    });
    const [next] = pool.splice(bestIdx, 1);
    picked.push(next);
    const cat = categoryOf(next.pageId);
    shown.set(cat, (shown.get(cat) ?? 0) + 1);
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
