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
import { buildIrmaaRows } from "@/lib/presentations/pages/tax-summary/aggregate";

export interface NamedRef {
  id: string;
  name: string;
}

/** A live scenario, with what its changes touch — enough for the comparison
 *  reports to decide whether comparing against it says anything. */
export interface ScenarioSummary extends NamedRef {
  changeCount: number;
  addsRothConversion: boolean;
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
  educationGoals: number;
  salaryIncome: number;
  annualSavings: number;
  absorbsSurplus: boolean;

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
}

const BUSINESS_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);
// A balance this small is the projection's rounding, not a portfolio.
const MATERIAL_BALANCE = 10_000;

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

function isAmortizing(l: Liability): boolean {
  return l.liabilityType !== "credit_card" && l.balance > 0;
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
  let withdrawalFirstYear: number | null = null;
  let depletionYear: number | null = null;
  let peakLiquid = 0;

  for (const y of projection.years) {
    const converted = (y.rothConversions ?? []).reduce((s, c) => s + c.gross, 0);
    if (converted > 0) {
      rothConverted += converted;
      rothFirstYear ??= y.year;
      rothLastYear = y.year;
    }
    if (y.withdrawals.total > 1_000) withdrawalFirstYear ??= y.year;
    const liquid = y.portfolioAssets.liquidTotal;
    if (depletionYear == null && y.year > currentYear && peakLiquid > MATERIAL_BALANCE && liquid <= 1) {
      depletionYear = y.year;
    }
    peakLiquid = Math.max(peakLiquid, liquid);
  }

  // Same rows the Tax Summary prints, so the reason and the report agree.
  const irmaa = buildIrmaaRows(projection.years);
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
  };
}

export function buildPlanFacts(input: {
  tree: ClientData;
  projection: ProjectionResult | null;
  extras: PlanFactExtras;
  today: Date;
}): PlanFacts {
  const { tree, projection, extras, today } = input;
  const year = today.getFullYear();
  const ages = principalAges(tree, today);

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

  const [top] = tree.liabilities
    .filter((l) => isAmortizing(l) && !isMortgage(l))
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
    educationGoals: tree.expenses.filter((e) => e.type === "education").length,
    salaryIncome: sumBy(
      tree.incomes.filter((i) => i.type === "salary" && !i.ownerEntityId && activeIn(i, year)),
      (i) => i.annualAmount,
    ),
    annualSavings: sumBy(tree.savingsRules.filter((r) => activeIn(r, year)), (r) => r.annualAmount),
    absorbsSurplus: tree.expenses.some(
      (e) => e.type === "living" && e.absorbsRemainingCashFlow && !e.ownerEntityId && !e.ownerAccountId,
    ),
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
    projected: projection ? projectedFacts(projection, year) : null,
  };
}
