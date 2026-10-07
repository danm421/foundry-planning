// The facts about one plan that decide which reports are worth suggesting.
//
// Pure: a ClientData tree, its projection and a few storage counts in, a flat
// serializable record out. Everything a rule in `score-reports.ts` reads is
// here, so a rule never reaches back into the tree — which keeps the rules a
// table of plain conditions and keeps this the one place that knows the
// engine's shapes.
import type { ProjectionResult } from "@/engine/projection";
import type { ClientData, GiftEvent, Liability } from "@/engine/types";
import { ageOnDate } from "@/lib/age-year";
import { DEFAULT_MEDICARE_ENROLLMENT_AGE } from "@/lib/medicare/constants";
import { resolveLtcEvent } from "@/engine/ltc-event";
import { largestMovableDeferral } from "@/lib/presentations/pages/early-years-shared";
import { eligibleLoans } from "@/lib/presentations/pages/early-years-debt-or-invest/target-loan";
import {
  buildCapGainsEvents,
  buildIrmaaRows,
  computeLifetimeTotals,
} from "@/lib/presentations/pages/tax-summary/aggregate";
import { buildTaxBracketRows, type TaxBracketRow } from "@/lib/tax/bracket";
import type { ChangeRow, ScenarioFacts } from "./scenario-facts";
import { buildScenarioFacts } from "./scenario-facts";

export interface NamedRef {
  id: string;
  name: string;
}

/** A live scenario, with what its changes touch — enough for the comparison
 *  reports to decide whether comparing against it says anything. */
export interface ScenarioSummary extends NamedRef {
  changeCount: number;
  /** Adds or edits a Roth conversion — the Roth pages have something to show. */
  hasRothConversion: boolean;
}

export interface DebtFact extends NamedRef {
  balance: number;
  interestRate: number;
}

/** What storage knows that the tree does not. Loaded beside the tree by
 *  `load-plan-facts.ts`; plain values so this module stays DB-free. */
export interface PlanFactExtras {
  planRef: string;
  scenarios: ScenarioSummary[];
  proposals: NamedRef[];
  hasHoldings: boolean;
  observationCount: number;
  storyChapterCount: number;
}

export interface ProjectedFacts {
  rothConverted: number;
  rothFirstYear: number | null;
  rothLastYear: number | null;
  /** Federal + state estate tax across both deaths. */
  estateTax: number;
  /** Gross estate at the final death (or the only death). */
  grossEstate: number;
  irmaaTotal: number;
  irmaaFirstYear: number | null;
  withdrawalFirstYear: number | null;
  /** First year the liquid portfolio runs dry after having held real money. */
  depletionYear: number | null;
  /** Lifetime taxes — the same sums the Tax Summary prints. */
  lifetimeTax: { total: number; federal: number; state: number; capitalGains: number };
  /** Highest federal bracket any year reaches. Bracket tax only; null without brackets. */
  topFederalRate: number | null;
  /** Years whose taxable income ends within BRACKET_EDGE of the next federal bracket. */
  bracketEdgeYears: number;
  /** The Tax Bracket page's own story: the top bracket a conversion year
   *  reaches, and how many conversion years end at a bracket edge. */
  conversionTopRate: number | null;
  conversionEdgeYears: number;
  conversionYears: number;
  /** Years paying AMT or the 3.8% investment tax. */
  amtOrNiitYears: number;
  /** The largest one-year capital gain of $25k or more. */
  bigGain: { year: number; gain: number } | null;
  itemizingYears: number;
  aboveLineTotal: number;
  /** Below-the-line deductions actually taken, standard or itemized. */
  belowLineTaken: number;
  /** Liquid portfolio in the projection's last year — the figure Forge's
   *  scenario comparison reads. */
  endingPortfolio: number;
  ssFirstYear: number | null;
  lifetimeExpenses: number;
  lifetimeSavings: number;
  lifetimeDebtPayments: number;
  giftsGiven: number;
  firstToDie: "client" | "spouse" | null;
  /** An employer match lands in the first projection year. */
  employerMatch: boolean;
}

export interface PlanFacts extends PlanFactExtras {
  currentYear: number;
  married: boolean;
  clientFirstName: string;
  clientAge: number | null;
  /** Youngest principal's age — "young household" keys on it. */
  youngestAge: number | null;
  /** Years until the NEXT principal retires; 0 once everyone has. */
  yearsToRetirement: number | null;
  allRetired: boolean;
  /** The year the older principal reaches Medicare age. */
  medicareYear: number | null;
  minorChildren: number;
  /** Education goals and any other expense marked as a goal. */
  goalCount: number;
  salaryIncome: number;
  annualSavings: number;
  absorbsSurplus: boolean;
  /** The plan figures tax bracket by bracket, not at flat rates — the bracket
   *  pages and the Roth-or-Traditional sheet print nothing otherwise. */
  bracketMode: boolean;
  /** A 401(k)/403(b) deferral the Early Years levers can move. */
  hasMovableDeferral: boolean;
  /** Stress tests and long-term-care events the plan runs under, in plain words. */
  stressItems: string[];

  liquidPortfolio: number;
  preTax: number;
  roth: number;
  realEstate: number;
  business: number;
  netWorth: number;

  /** The costliest non-mortgage, amortizing debt — the Debt-or-Invest sheet's
   *  natural subject. */
  topDebt: DebtFact | null;

  trusts: NamedRef[];
  businesses: NamedRef[];
  willCount: number;
  giftCount: number;
  lifePolicyCount: number;
  lifeFaceValue: number;

  projected: ProjectedFacts | null;
  /** The chosen scenario: what it changes and how it moved against Base Case.
   *  Null for Base Case, a snapshot, or a scenario with no active changes. */
  scenario: ScenarioFacts | null;
}

const BUSINESS_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);
// A balance this small is the projection's rounding, not a portfolio.
const MATERIAL_BALANCE = 10_000;

/** Taxable income this close to the top of its bracket sits "at the edge". */
export const BRACKET_EDGE = 10_000;

const atEdge = (r: TaxBracketRow) => r.remainingInBracket != null && r.remainingInBracket <= BRACKET_EDGE;
const topRate = (rows: TaxBracketRow[]) => (rows.length ? Math.max(...rows.map((r) => r.marginalRate)) : null);

/** Mirrors the Assumptions page's stress list (assumptions/view-model.ts):
 *  present means on, and a tax-rate stress applies only on bracket tax. */
function stressItems(tree: ClientData): string[] {
  const s = tree.planSettings;
  return [
    s.ssBenefitHaircut && "a Social Security cut",
    s.marketShock && "a market drop",
    s.taxRateStress && s.taxEngineMode === "bracket" && "higher tax rates",
    s.disabilityEvent && "a disability",
    (resolveLtcEvent(tree)?.people.length ?? 0) > 0 && "long-term care",
  ].filter((x): x is string => typeof x === "string");
}

function activeIn(row: { startYear: number; endYear?: number }, year: number): boolean {
  return row.startYear <= year && (row.endYear == null || row.endYear >= year);
}

/** Gifts as the advisor entered them: a series fans out one event per year and
 *  an asset gift carries its debt along as a second event, so count sources,
 *  not events. */
function countGifts(events: GiftEvent[]): number {
  const keys = new Set<string>();
  events.forEach((g, i) => {
    if (g.kind === "liability") return;
    const series = "seriesId" in g ? g.seriesId : undefined;
    keys.add(series ?? ("sourceGiftId" in g ? g.sourceGiftId : undefined) ?? `event-${i}`);
  });
  return keys.size;
}

/** Imported and hand-entered loans often carry no type, so the name counts. */
function isMortgage(l: Liability): boolean {
  return (
    l.liabilityType === "mortgage" ||
    l.liabilityType === "heloc" ||
    Boolean(l.linkedPropertyId) ||
    /mortgage|heloc|home equity/i.test(l.name)
  );
}

function principalAges(tree: ClientData, today: Date) {
  const year = today.getFullYear();
  const c = tree.client;
  const married = Boolean(c.spouseDob) && c.filingStatus !== "single";
  const clientAge = ageOnDate(c.dateOfBirth, today);
  const spouseAge = married ? ageOnDate(c.spouseDob, today) : null;
  const working: number[] = [];
  if (clientAge != null) working.push(Math.max(0, c.retirementAge - clientAge));
  if (spouseAge != null) {
    working.push(Math.max(0, (c.spouseRetirementAge ?? c.retirementAge) - spouseAge));
  }
  const ages = [clientAge, spouseAge].filter((a): a is number => a != null);
  const stillWorking = working.filter((y) => y > 0);
  return {
    married,
    clientAge,
    youngestAge: ages.length ? Math.min(...ages) : null,
    medicareYear: ages.length ? year + DEFAULT_MEDICARE_ENROLLMENT_AGE - Math.max(...ages) : null,
    yearsToRetirement: working.length ? (stillWorking.length ? Math.min(...stillWorking) : 0) : null,
    allRetired: working.length > 0 && stillWorking.length === 0,
  };
}

export function projectedFacts(projection: ProjectionResult, currentYear: number): ProjectedFacts {
  let rothConverted = 0;
  let rothFirstYear: number | null = null;
  let rothLastYear: number | null = null;
  let conversionYears = 0;
  let withdrawalFirstYear: number | null = null;
  let depletionYear: number | null = null;
  let peakLiquid = 0;
  let ssFirstYear: number | null = null;
  let lifetimeExpenses = 0;
  let lifetimeSavings = 0;
  let lifetimeDebtPayments = 0;
  let amtOrNiitYears = 0;
  let itemizingYears = 0;
  let aboveLineTotal = 0;
  let belowLineTaken = 0;

  for (const y of projection.years) {
    const converted = (y.rothConversions ?? []).reduce((s, c) => s + c.gross, 0);
    if (converted > 0) {
      rothConverted += converted;
      rothFirstYear ??= y.year;
      rothLastYear = y.year;
      conversionYears++;
    }
    if (y.withdrawals.total > 1_000) withdrawalFirstYear ??= y.year;
    const liquid = y.portfolioAssets.liquidTotal;
    if (depletionYear == null && y.year > currentYear && peakLiquid > MATERIAL_BALANCE && liquid <= 1) {
      depletionYear = y.year;
    }
    peakLiquid = Math.max(peakLiquid, liquid);
    if (y.income.socialSecurity > 0) ssFirstYear ??= y.year;
    lifetimeExpenses += y.expenses.total;
    lifetimeSavings += y.savings.total;
    lifetimeDebtPayments += y.expenses.liabilities;
    const flow = y.taxResult?.flow;
    if (flow && (flow.amtAdditional > 0 || flow.niit > 0)) amtOrNiitYears++;
    const d = y.deductionBreakdown;
    if (d) {
      aboveLineTotal += d.aboveLine.total;
      belowLineTaken += d.belowLine.taxDeductions;
      if (d.belowLine.itemizedTotal > d.belowLine.standardDeduction) itemizingYears++;
    }
  }

  // Same helpers the Tax Summary and Tax Bracket pages print from, so each
  // reason and its page agree.
  const irmaa = buildIrmaaRows(projection.years);
  const tax = computeLifetimeTotals(projection.years);
  const brackets = buildTaxBracketRows(projection.years);
  const conversionRows = brackets.filter((r) => r.conversionGross > 0);
  const [bigGain] = buildCapGainsEvents(projection.years).sort((a, b) => b.gain - a.gain);
  const first = projection.firstDeathEvent;
  const second = projection.secondDeathEvent;
  return {
    rothConverted,
    rothFirstYear,
    rothLastYear,
    estateTax: (first?.totalEstateTax ?? 0) + (second?.totalEstateTax ?? 0),
    grossEstate: second?.grossEstate ?? first?.grossEstate ?? 0,
    irmaaTotal: irmaa.reduce((s, r) => s + r.surcharge, 0),
    irmaaFirstYear: irmaa[0]?.year ?? null,
    withdrawalFirstYear,
    depletionYear,
    lifetimeTax: {
      total: tax.lifetimeTotal,
      federal: tax.lifetimeFederal,
      state: tax.lifetimeState,
      capitalGains: tax.lifetimeCapGains,
    },
    topFederalRate: topRate(brackets),
    bracketEdgeYears: brackets.filter(atEdge).length,
    conversionTopRate: topRate(conversionRows),
    conversionEdgeYears: conversionRows.filter(atEdge).length,
    conversionYears,
    amtOrNiitYears,
    bigGain: bigGain ? { year: bigGain.year, gain: bigGain.gain } : null,
    itemizingYears,
    aboveLineTotal,
    belowLineTaken,
    endingPortfolio: projection.years.at(-1)?.portfolioAssets.liquidTotal ?? 0,
    ssFirstYear,
    lifetimeExpenses,
    lifetimeSavings,
    lifetimeDebtPayments,
    giftsGiven: projection.giftLedger.reduce((s, g) => s + g.giftsGiven, 0),
    firstToDie: first?.deceased ?? null,
    employerMatch: (projection.years[0]?.savings.employerTotal ?? 0) > 0,
  };
}

export function buildPlanFacts(input: {
  tree: ClientData;
  projection: ProjectionResult | null;
  extras: PlanFactExtras;
  today: Date;
  /** Present when the chosen plan is a live scenario. */
  scenario?: {
    id: string;
    name: string;
    rows: ChangeRow[];
    baseTree: ClientData;
    baseProjection: ProjectionResult | null;
  };
}): PlanFacts {
  const { tree, projection, extras, today, scenario } = input;
  const year = today.getFullYear();
  const ages = principalAges(tree, today);
  const projected = projection ? projectedFacts(projection, year) : null;

  const sumBy = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const accountsIn = (...cats: string[]) => tree.accounts.filter((a) => cats.includes(a.category));

  const retirement = accountsIn("retirement");
  const roth = sumBy(retirement, (a) => (a.subType === "roth_ira" ? a.value : a.rothValue ?? 0));
  const preTax = sumBy(
    retirement.filter((a) => a.subType !== "roth_ira" && a.subType !== "hsa"),
    (a) => a.value - (a.rothValue ?? 0),
  );
  const liquidPortfolio = sumBy(accountsIn("taxable", "cash", "retirement", "annuity"), (a) => a.value);
  const realEstate = sumBy(accountsIn("real_estate"), (a) => a.value);
  const business = sumBy(accountsIn("business"), (a) => a.value);
  const assets = sumBy(tree.accounts, (a) => a.value);
  const debts = sumBy(tree.liabilities, (l) => l.balance);

  // Only a loan the Debt-or-Invest sheet can reach — a held-flat debt (credit
  // card, no term) prints "no loan an extra payment could reach".
  const [top] = eligibleLoans(tree)
    .filter((l) => !isMortgage(l))
    .sort((a, b) => b.interestRate - a.interestRate || b.balance - a.balance);

  const minorChildren = (tree.familyMembers ?? []).filter((m) => {
    if (m.relationship !== "child" && m.relationship !== "stepchild") return false;
    const age = ageOnDate(m.dateOfBirth, today);
    return age != null && age < 18;
  }).length;

  const entities = tree.entities ?? [];
  const named = (e: { id: string; name?: string }, fallback: string) => ({ id: e.id, name: e.name ?? fallback });
  const lifePolicies = tree.accounts.filter((a) => a.category === "life_insurance");

  return {
    ...extras,
    currentYear: year,
    ...ages,
    clientFirstName: tree.client.firstName,
    minorChildren,
    goalCount: tree.expenses.filter((e) => e.type === "education" || e.isGoal).length,
    salaryIncome: sumBy(
      tree.incomes.filter((i) => i.type === "salary" && !i.ownerEntityId && activeIn(i, year)),
      (i) => i.annualAmount,
    ),
    annualSavings: sumBy(tree.savingsRules.filter((r) => activeIn(r, year)), (r) => r.annualAmount),
    absorbsSurplus: tree.expenses.some(
      (e) => e.type === "living" && e.absorbsRemainingCashFlow && !e.ownerEntityId && !e.ownerAccountId,
    ),
    bracketMode: tree.planSettings.taxEngineMode === "bracket",
    hasMovableDeferral: largestMovableDeferral(tree, year) != null,
    stressItems: stressItems(tree),
    liquidPortfolio,
    preTax,
    roth,
    realEstate,
    business,
    netWorth: assets - debts,
    topDebt: top ? { id: top.id, name: top.name, balance: top.balance, interestRate: top.interestRate } : null,
    trusts: entities.filter((e) => e.entityType === "trust").map((e) => named(e, "Trust")),
    businesses: entities
      .filter((e) => e.entityType != null && BUSINESS_TYPES.has(e.entityType))
      .map((e) => named(e, "Business")),
    willCount: (tree.wills ?? []).length,
    giftCount: countGifts(tree.giftEvents),
    lifePolicyCount: lifePolicies.length,
    lifeFaceValue: sumBy(lifePolicies, (a) => a.lifeInsurance?.faceValue ?? 0),
    projected,
    scenario:
      scenario && scenario.rows.length > 0
        ? buildScenarioFacts({
            id: scenario.id,
            name: scenario.name,
            rows: scenario.rows,
            baseTree: scenario.baseTree,
            planTree: tree,
            plan: projected,
            base: scenario.baseProjection ? projectedFacts(scenario.baseProjection, year) : null,
          })
        : null,
  };
}
