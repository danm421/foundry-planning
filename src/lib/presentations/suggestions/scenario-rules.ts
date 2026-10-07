// Which reports a scenario's own changes bring up — the scenario tier.
//
// One table per change type, read top to bottom: "what does a Roth scenario
// bring up?" is the `roth` block. A rule fires only when its "moved against
// Base Case" test passes (spec §3), so a conversion capped to nothing brings
// up no Roth card (the Expenses rules are ungated, by design). Every match outranks
// any plan match (score-reports.ts), and each page keeps its best match.
//
// Runs only when both the scenario and Base Case projected: the comparison
// pages project the same two plans, and the reasons quote both.
import type { PresentationPageId } from "@/components/presentations/registry";
import type { PlanFacts, ProjectedFacts } from "./plan-facts";
import type { ChangeDetail, ChangeType, ScenarioFacts } from "./scenario-facts";
import type { Match, ReportSuggestion } from "./score-reports";
import {
  capitalize,
  conversionBracketReason,
  conversionSpan,
  listPhrase,
  money,
  plural,
  portfolioDelta,
  signed,
  upDown,
} from "./reason-text";

export type ScenarioTopic = ChangeType | "anyChange";

interface ScenarioContext {
  f: PlanFacts;
  s: ScenarioFacts;
  /** The scenario's own projection, and Base Case's. */
  p: ProjectedFacts;
  b: ProjectedFacts;
  d: ChangeDetail;
  /** The scenario's name in curly quotes. */
  name: string;
}

type ScenarioRule = (c: ScenarioContext) => Match | null | false | undefined;

const pointAt = (c: ScenarioContext) => ({ scenarioId: c.s.id });
export const CONVERSION_YEARS = { range: "rothConversionYears" } as const;
/** Estate pages start with whoever dies first in the projection. */
export function orderingPatch(p: ProjectedFacts | null | undefined): Record<string, unknown> | undefined {
  return p?.firstToDie === "spouse" ? { ordering: "spouseFirst" } : undefined;
}
/** The scenario removed a named trust or business: it has no id in the plan any more. */
const removedEntity = (d: ChangeDetail) => d.id == null && !!d.name;
const longevity = (c: ScenarioContext) => (c.p.depletionYear != null ? { highlight: "longevity" } : undefined);
const ageMove = (d: ChangeDetail) => d.fromAge != null && d.toAge != null;
/** The new age is known, whether or not the old one was (an FRA-mode claim has none). */
const newAge = (d: ChangeDetail) => d.toAge != null;
/** More than one change type: the projection moved for all of them together,
 *  so a whole-plan figure can't be credited to the one change a card is filed under. */
const mixed = (c: ScenarioContext) => Object.keys(c.s.changes).length > 1;
/** `named` = the sentence already names the scenario, so say "of its changes" instead of repeating it. */
const withAll = (c: ScenarioContext, named = false) => `with all ${c.s.changeCount} ${named ? "of its changes" : `changes in ${c.name}`}`;
/** "with all N changes in “X”, " for a mixed scenario, nothing for a single change type. */
const mixedPrefix = (c: ScenarioContext, named = false) => (mixed(c) ? `${withAll(c, named)}, ` : "");
/** A sentence about a whole-plan figure: `single` for one change type; for several,
 *  "With all N changes in “X”, <several>". The one place that choice is made. */
const scoped = (c: ScenarioContext, single: string, several: string) =>
  mixed(c) ? `${capitalize(withAll(c))}, ${several}` : single;
/** `scoped` where the one-type sentence is "<subject> <predicate>". */
const attribute = (c: ScenarioContext, subject: string, predicate: string) => scoped(c, `${subject} ${predicate}`, predicate);
/** `scoped` where the one-type sentence is the predicate, capitalised. */
const claim = (c: ScenarioContext, predicate: string) => scoped(c, capitalize(predicate), predicate);
/** The portfolio's move against Base Case, named for the whole scenario when it changes several things. */
const pd = (c: ScenarioContext, named = false) => `${mixedPrefix(c, named)}${portfolioDelta(c.p, c.b)}`;
/** "With the new spending, …" — or, for a mixed scenario, "With all N changes in “X”, …". */
const portfolioLead = (c: ScenarioContext, single: string) => `${attribute(c, `${single},`, portfolioDelta(c.p, c.b))}.`;
const verdict = (c: ScenarioContext, question: string, named = false): Match => ({
  score: 0,
  reason: `${question} ${capitalize(pd(c, named))}.`,
  optionsPatch: pointAt(c),
});
const taxDelta = (c: ScenarioContext) => upDown(c.p.lifetimeTax.total - c.b.lifetimeTax.total);
const taxComparisonRule = (gate: (c: ScenarioContext) => boolean, score: number): ScenarioRule => (c) =>
  gate(c) && {
    score,
    reason: `Lifetime taxes under ${c.name} against Base Case: ${taxDelta(c)}.`,
    optionsPatch: pointAt(c),
  };
const estateReason = (c: ScenarioContext) => {
  const [label, delta] =
    Math.abs(c.p.estateTax - c.b.estateTax) >= 10_000
      ? ["estate tax", c.p.estateTax - c.b.estateTax]
      : ["gross estate", c.p.grossEstate - c.b.grossEstate];
  return claim(c, `${label} ${upDown(delta)} against Base Case.`);
};
const rangeAround = (year: number | undefined) =>
  year != null ? { range: { startYear: year - 1, endYear: year + 2 } } : undefined;
/** The next retirement year on the scenario's own ages. */
const retirementYear = (f: PlanFacts) =>
  f.yearsToRetirement != null && f.yearsToRetirement > 0 ? f.currentYear + f.yearsToRetirement : null;

export const SCENARIO_RULES: Record<ScenarioTopic, Partial<Record<PresentationPageId, ScenarioRule>>> = {
  roth: {
    rothConversion: (c) => c.s.moved.convertsMore && {
      score: 98,
      reason: `${c.name} converts ${money(c.p.rothConverted)} to Roth${conversionSpan(c.p)} — what it costs now and saves later.`,
      optionsPatch: pointAt(c),
    },
    incomeTaxBracketFederal: (c) => c.f.bracketMode && c.s.moved.convertsMore && {
      score: 95,
      reason: conversionBracketReason(c.p),
      optionsPatch: CONVERSION_YEARS,
    },
    taxComparison: taxComparisonRule((c) => c.s.moved.convertsMore, 92),
    incomeTaxBracketState: (c) => c.f.bracketMode && c.s.moved.convertsMore && c.s.moved.stateTax && c.p.lifetimeTax.state > 0 && {
      score: 88,
      reason: attribute(c, "The conversions move", `state tax ${upDown(c.p.lifetimeTax.state - c.b.lifetimeTax.state)} — this shows each year's state bracket.`),
      optionsPatch: CONVERSION_YEARS,
    },
    incomeTaxFederal: (c) => c.s.moved.convertsMore && {
      score: 84,
      reason: mixed(c)
        ? `Federal tax line by line: ${withAll(c)}, ${upDown(c.p.lifetimeTax.federal - c.b.lifetimeTax.federal)} against Base Case.`
        : `Federal tax line by line: ${upDown(c.p.lifetimeTax.federal - c.b.lifetimeTax.federal)} against Base Case${c.p.lifetimeTax.federal > c.b.lifetimeTax.federal ? ", most in the conversion years" : ""}.`,
      optionsPatch: CONVERSION_YEARS,
    },
    medicareSummary: (c) => c.s.moved.irmaa && {
      score: 80,
      reason: attribute(c, "The conversions move", `Medicare surcharges (IRMAA) ${upDown(c.p.irmaaTotal - c.b.irmaaTotal)} against Base Case.`),
    },
    incomeTaxIncome: (c) => c.s.moved.convertsMore && {
      score: 72,
      reason: "Shows the conversions stacked on top of the household's other income.",
      optionsPatch: CONVERSION_YEARS,
    },
  },

  retirementAge: {
    retirementSummary: (c) => ({
      score: 96,
      reason: newAge(c.d)
        ? `${c.name} moves ${c.d.who}'s retirement ${ageMove(c.d) ? `from ${c.d.fromAge} ` : ""}to ${c.d.toAge} — what funds each year, and how long it lasts.`
        : `${c.name} moves the retirement date — what funds each year, and how long it lasts.`,
    }),
    retirementComparison: (c) => ({
      score: 94,
      reason: `${newAge(c.d) ? `Retiring at ${c.d.toAge}${ageMove(c.d) ? ` instead of ${c.d.fromAge}` : ""}` : `Under ${c.name}`}: ${pd(c)}.`,
      optionsPatch: pointAt(c),
    }),
    cashFlow: (c) => ({
      score: 90,
      reason: `Year by year after ${newAge(c.d) ? `retiring at ${c.d.toAge}` : "the new retirement date"}: ${pd(c)}.`,
    }),
    monteCarlo: (c) => ({
      score: 86,
      reason: newAge(c.d)
        ? `How sure is retiring at ${c.d.toAge}? The odds across a thousand markets.`
        : `How sure is ${c.name}? The odds across a thousand markets.`,
      optionsPatch: longevity(c),
    }),
    cashFlowMonthly: (c) => {
      const year = retirementYear(c.f);
      return year != null && {
        score: 80,
        reason: `The monthly budget in ${year}, the first year of retirement.`,
        optionsPatch: { view: "months", year },
      };
    },
  },

  planLength: {
    cashFlow: (c) => ({ score: 84, reason: `Runs the plan to its new end: ${pd(c)}.` }),
    retirementSummary: () => ({ score: 80, reason: "How long the money lasts over the plan's new length." }),
    monteCarlo: () => ({
      score: 78,
      reason: "The odds the money lasts to the plan's new end.",
      optionsPatch: { highlight: "longevity" },
    }),
  },

  socialSecurity: {
    retirementSummary: (c) => ({
      score: 96,
      reason: newAge(c.d)
        ? `${c.name} moves Social Security ${ageMove(c.d) ? `from ${c.d.fromAge} ` : ""}to ${c.d.toAge} — the claim-age ladder shows what each age pays.`
        : `${c.name} changes Social Security — the claim-age ladder shows what each age pays.`,
    }),
    retirementComparison: (c) => ({
      score: 92,
      reason: `${newAge(c.d) ? `Claiming at ${c.d.toAge}` : `Under ${c.name}`}: ${pd(c)}.`,
      optionsPatch: pointAt(c),
    }),
    cashFlowIncome: (c) => c.s.moved.socialSecurity && c.p.ssFirstYear != null && {
      score: 86,
      reason: `Social Security now starts in ${c.p.ssFirstYear}${c.b.ssFirstYear != null ? ` instead of ${c.b.ssFirstYear}` : ""}.`,
    },
    cashFlowWithdrawals: (c) => c.s.moved.socialSecurity && c.p.ssFirstYear != null && {
      score: 82,
      reason: `How the portfolio covers the years before Social Security starts in ${c.p.ssFirstYear}.`,
    },
    mapGoals: (c) => c.s.moved.socialSecurity && {
      score: 72,
      reason: newAge(c.d)
        ? `Social Security at ${c.d.toAge}, retirement and goals on one timeline.`
        : "Social Security, retirement and goals on one timeline.",
    },
  },

  otherIncome: {
    cashFlowIncome: (c) => ({
      score: 90,
      reason: `${c.name} changes ${plural(c.d.count, "income source")} — income by source, year by year.`,
    }),
    cashFlow: (c) => c.s.moved.portfolio && { score: 86, reason: portfolioLead(c, "With the income change") },
    retirementComparison: (c) => c.s.moved.portfolio && { ...verdict(c, `Does ${c.name} beat Base Case?`, true), score: 80 },
    taxSummary: (c) => c.s.moved.tax && {
      score: 72,
      reason: `Lifetime tax under ${c.name}: ${taxDelta(c)} against Base Case.`,
    },
  },

  spending: {
    cashFlowExpenses: (c) => ({
      score: 90,
      reason: scoped(c, `${c.name} changes spending by ${signed(c.p.lifetimeExpenses - c.b.lifetimeExpenses)} over the plan.`, `spending changes by ${signed(c.p.lifetimeExpenses - c.b.lifetimeExpenses)} over the plan.`),
    }),
    cashFlow: (c) => c.s.moved.portfolio && { score: 88, reason: portfolioLead(c, "With the new spending") },
    retirementComparison: (c) => c.s.moved.portfolio && { ...verdict(c, `Can the plan afford ${c.name}?`, true), score: 84 },
    monteCarlo: (c) => c.s.moved.portfolio && {
      score: 78,
      reason: "How the new spending holds up across a thousand markets.",
      optionsPatch: longevity(c),
    },
    cashFlowMonthly: () => ({ score: 74, reason: "What the new spending means month by month." }),
  },

  savings: {
    cashFlowSavings: (c) => {
      const delta = c.p.lifetimeSavings - c.b.lifetimeSavings;
      return {
        score: 92,
        reason: Math.abs(delta) < 1_000
          ? `${c.name} changes how the savings are split, account by account.`
          : `${c.name} saves ${money(Math.abs(delta))} ${delta > 0 ? "more" : "less"} over the plan, account by account.`,
      };
    },
    retirementComparison: (c) => c.s.moved.portfolio && { ...verdict(c, `Does saving differently beat Base Case?`), score: 86 },
    retirementSummary: (c) => ({ score: 80, reason: `Where the new savings leave retirement: ${pd(c)}.` }),
    incomeTaxAboveLine: (c) => Math.abs(c.p.aboveLineTotal - c.b.aboveLineTotal) >= 5_000 && {
      score: 66,
      reason: attribute(c, "Pre-tax savings move", `deductions ${upDown(c.p.aboveLineTotal - c.b.aboveLineTotal)} over the plan.`),
    },
  },

  relocation: {
    incomeTaxState: (c) => c.s.moved.stateTax && {
      score: 96,
      reason: `${c.d.name ? `“${c.d.name}”${c.d.year ? ` in ${c.d.year}` : ""}` : c.name}: ${mixedPrefix(c)}lifetime state tax ${upDown(c.p.lifetimeTax.state - c.b.lifetimeTax.state)}.`,
    },
    taxComparison: taxComparisonRule((c) => c.s.moved.stateTax, 92),
    incomeTaxBracketState: (c) => c.f.bracketMode && c.s.moved.stateTax && c.p.lifetimeTax.state > 0 && {
      score: 84,
      reason: "Each year's state bracket, before and after the move.",
    },
    taxSummary: (c) => ({
      score: 78,
      reason: `Lifetime tax under ${c.name}: ${money(c.p.lifetimeTax.federal)} federal, ${money(c.p.lifetimeTax.state)} state.`,
    }),
  },

  assetTransaction: {
    balanceSheet: (c) => ({
      score: 88,
      reason: c.d.year ? `Net worth at the end of ${c.d.year}, after the transaction.` : "Net worth after the transaction.",
      optionsPatch: c.d.year ? { asOf: "eoy", year: c.d.year } : undefined,
    }),
    incomeTaxOtherTaxes: (c) => c.s.moved.gains && {
      score: 86,
      reason: attribute(c, `The transaction${c.d.year ? ` in ${c.d.year}` : ""} moves`, `capital-gains tax ${upDown(c.p.lifetimeTax.capitalGains - c.b.lifetimeTax.capitalGains)}.`),
      optionsPatch: rangeAround(c.d.year),
    },
    cashFlowAssets: (c) => ({
      score: 82,
      reason: c.d.year ? `Balances by asset type before and after ${c.d.year}.` : "Balances by asset type, year by year.",
    }),
    taxComparison: taxComparisonRule((c) => c.s.moved.tax, 80),
    incomeTaxIncome: (c) => c.s.moved.gains && {
      score: 74,
      reason: c.d.year ? `The ${c.d.year} gain stacked on that year's other income.` : "The gain stacked on that year's other income.",
      optionsPatch: rangeAround(c.d.year),
    },
  },

  gifts: {
    estateGiftTax: (c) => ({
      score: 96,
      reason: c.p.giftsGiven > 0
        ? `${c.name} gives ${money(c.p.giftsGiven)} in lifetime gifts — the exemption they use, year by year.`
        : `${c.name} changes the lifetime gifts — the exemption they use, year by year.`,
    }),
    estateSummary: (c) => c.s.moved.estate && { score: 92, reason: estateReason(c), optionsPatch: orderingPatch(c.p) },
    estateTransfer: (c) => c.s.moved.estate && { score: 86, reason: "What the heirs would keep each year, with the gifts made." },
    estateFlowChart: (c) => ({
      score: 82,
      reason: "Follows the estate, after the gifts, through each death to the heirs.",
      optionsPatch: orderingPatch(c.p),
    }),
    estateLiquidity: (c) => c.p.estateTax > 0 && {
      score: 76,
      reason: `Checks there's still cash to pay ${money(c.p.estateTax)} of estate tax after the gifts.`,
    },
    retirementComparison: (c) => c.s.moved.portfolio && { ...verdict(c, "Can they afford the gifts?"), score: 66 },
  },

  estateDocs: {
    estateFlow: (c) => ({
      score: 94,
      reason: "Spells out the changed wills and beneficiaries: who receives what at each death.",
      optionsPatch: orderingPatch(c.p),
    }),
    estateFlowChart: (c) => ({
      score: 90,
      reason: "Follows the estate through each death to the heirs under the new wishes.",
      optionsPatch: orderingPatch(c.p),
    }),
    estateSummary: (c) => ({
      score: 86,
      reason: "Who receives what under the changed wills, and what it costs to get it there.",
      optionsPatch: orderingPatch(c.p),
    }),
    estateTransfer: (c) => c.s.moved.estate && { score: 72, reason: "What the heirs would keep each year under the changed wills." },
  },

  entities: {
    // A page can't show an entity the scenario removed, so its reason can't
    // name it, and Entities has nothing to print unless another one remains.
    entitiesBalanceSheet: (c) => {
      const gone = removedEntity(c.d);
      if (gone && c.f.trusts.length + c.f.businesses.length === 0) return null;
      return {
        score: 92,
        reason: c.d.name && !gone ? `Assets, debts and net worth for ${c.d.name}.` : "Assets, debts and net worth for each trust and business.",
      };
    },
    estateFlowChart: (c) => ({
      score: 88,
      reason: removedEntity(c.d)
        ? `Shows what passes at each death without ${c.d.name}.`
        : c.d.name ? `Shows what passes through ${c.d.name} at each death.` : "Shows what passes through the trusts at each death.",
      optionsPatch: orderingPatch(c.p),
    }),
    estateSummary: (c) => ({
      score: c.s.moved.estate ? 86 : 76,
      reason: c.s.moved.estate
        ? estateReason(c)
        : removedEntity(c.d) ? `Who receives what without ${c.d.name}.` : `How ${c.d.name ?? "the change"} changes who receives what.`,
      optionsPatch: orderingPatch(c.p),
    }),
    entityCashFlow: (c) => c.d.id != null && {
      score: 84,
      reason: `Follows the cash through ${c.d.name ?? "the trust"}.`,
      optionsPatch: { entityId: c.d.id, entityName: c.d.name ?? "" },
    },
    mapNetWorth: (c) => ({
      score: 74,
      reason: removedEntity(c.d)
        ? `Who owns what without ${c.d.name}.`
        : c.d.name ? `Who owns what, including ${c.d.name}.` : "Who owns what, including the trusts and businesses.",
    }),
  },

  investments: {
    cashFlowGrowth: (c) => ({ score: 90, reason: `${c.name} changes how the portfolio grows: ${pd(c, true)}.` }),
    retirementComparison: (c) => c.s.moved.portfolio && { ...verdict(c, `Does ${c.name} beat Base Case?`, true), score: 86 },
    monteCarlo: (c) => ({
      score: 84,
      reason: "How the new investment mix holds up across a thousand markets.",
      optionsPatch: longevity(c),
    }),
    cashFlowAssets: () => ({ score: 78, reason: "Balances by asset type under the new growth assumptions." }),
    assumptions: () => ({ score: 74, reason: "Documents the new growth and inflation assumptions." }),
  },

  stress: {
    assumptions: (c) => ({
      score: 92,
      reason: c.f.stressItems.length > 0
        ? `Spells out the stress test ${c.name} runs the plan under: ${listPhrase(c.f.stressItems)}.`
        : `Spells out the stress test ${c.name} runs the plan under.`,
      optionsPatch: { includeAccountTable: false, includeCmaAppendix: false },
    }),
    retirementComparison: (c) => ({ ...verdict(c, "Does the plan survive the stress?"), score: 90 }),
    cashFlow: (c) => ({ score: 86, reason: `Year by year under the stress: ${pd(c)}.` }),
    monteCarlo: (c) => ({ score: 80, reason: "The odds under the stress, across a thousand markets.", optionsPatch: longevity(c) }),
    cashFlowExpenses: (c) => c.d.ltc && { score: 76, reason: "The long-term-care costs, year by year." },
  },

  debts: {
    cashFlowExpenses: (c) => ({
      score: 86,
      reason: claim(c, `debt payments change by ${signed(c.p.lifetimeDebtPayments - c.b.lifetimeDebtPayments)} over the plan.`),
    }),
    balanceSheet: () => ({ score: 84, reason: "Net worth and debts as of today, with the loan changes." }),
    cashFlow: (c) => c.s.moved.portfolio && { score: 78, reason: portfolioLead(c, "With the loan changes") },
    retirementComparison: (c) => c.s.moved.portfolio && { ...verdict(c, `Does ${c.name} beat Base Case?`, true), score: 74 },
  },

  insurance: {
    estateLiquidity: (c) => c.p.estateTax > 0 && {
      score: 86,
      reason: `Checks the new coverage can pay ${money(c.p.estateTax)} of estate tax.`,
    },
    estateSummary: (c) => c.s.moved.estate && { score: 80, reason: estateReason(c), optionsPatch: orderingPatch(c.p) },
    cashFlowExpenses: (c) => ({
      score: 72,
      reason: scoped(c, `Premiums change spending by ${signed(c.p.lifetimeExpenses - c.b.lifetimeExpenses)} over the plan.`, `spending changes by ${signed(c.p.lifetimeExpenses - c.b.lifetimeExpenses)} over the plan.`),
    }),
    balanceSheet: () => ({ score: 68, reason: "Net worth with the coverage changes, as of today." }),
  },

  taxSettings: {
    incomeTaxBelowLine: (c) => Math.abs(c.p.belowLineTaken - c.b.belowLineTaken) >= 5_000 && {
      score: 92,
      reason: claim(c, `deductions taken below the line ${upDown(c.p.belowLineTaken - c.b.belowLineTaken)} against Base Case.`),
    },
    incomeTaxAboveLine: (c) => Math.abs(c.p.aboveLineTotal - c.b.aboveLineTotal) >= 5_000 && {
      score: 90,
      reason: claim(c, `above-the-line deductions ${upDown(c.p.aboveLineTotal - c.b.aboveLineTotal)} against Base Case.`),
    },
    incomeTaxFederal: (c) => Math.abs(c.p.lifetimeTax.federal - c.b.lifetimeTax.federal) >= 10_000 && {
      score: 86,
      reason: claim(c, `federal tax ${upDown(c.p.lifetimeTax.federal - c.b.lifetimeTax.federal)} against Base Case, line by line.`),
    },
    taxComparison: taxComparisonRule((c) => c.s.moved.tax, 84),
    medicareSummary: (c) => c.s.moved.irmaa && {
      score: 74,
      reason: scoped(c, `Medicare surcharges (IRMAA) ${upDown(c.p.irmaaTotal - c.b.irmaaTotal)} — the change moves the income Medicare counts.`, `Medicare surcharges (IRMAA) ${upDown(c.p.irmaaTotal - c.b.irmaaTotal)}.`),
    },
    taxSummary: (c) => ({ score: 70, reason: `Lifetime tax under ${c.name}: ${taxDelta(c)} against Base Case.` }),
  },

  withdrawalOrder: {
    cashFlowWithdrawals: () => ({ score: 92, reason: "Which accounts fund each year under the new withdrawal order." }),
    taxComparison: (c) => c.s.moved.tax && {
      score: 86,
      reason: attribute(c, "The new order moves", `lifetime taxes ${taxDelta(c)} against Base Case.`),
      optionsPatch: pointAt(c),
    },
    retirementComparison: (c) => c.s.moved.portfolio && { ...verdict(c, `Does ${c.name} beat Base Case?`, true), score: 82 },
    incomeTaxBracketFederal: (c) => c.f.bracketMode && c.s.moved.tax && {
      score: 74,
      reason: "How the new withdrawal order fills each year's federal bracket.",
    },
    medicareSummary: (c) => c.s.moved.irmaa && {
      score: 70,
      reason: scoped(c, `Medicare surcharges (IRMAA) ${upDown(c.p.irmaaTotal - c.b.irmaaTotal)} under the new order.`, `Medicare surcharges (IRMAA) ${upDown(c.p.irmaaTotal - c.b.irmaaTotal)}.`),
    },
  },

  accounts: {
    balanceSheet: (c) => ({ score: 84, reason: `Net worth with the account changes in ${c.name}.` }),
    mapNetWorth: () => ({ score: 80, reason: "Who owns what after the account changes." }),
    cashFlowActivity: (c) => c.d.transfer && { score: 76, reason: "Money moved into and out of the portfolio, year by year." },
    cashFlowAssets: (c) => c.s.moved.portfolio && { score: 74, reason: `Balances by asset type: ${pd(c)}.` },
  },

  anyChange: {
    retirementComparison: (c) => ({ ...verdict(c, `Does ${c.name} beat Base Case?`, true), score: 64 }),
    scenarioChanges: (c) => ({
      score: 58,
      reason: c.s.changeCount === 1
        ? `The one change ${c.name} makes, in plain words.`
        : `The ${c.s.changeCount} changes ${c.name} makes, in plain words.`,
      optionsPatch: pointAt(c),
    }),
  },
};

/** Every page the chosen scenario's own changes bring up, tagged with the
 *  change type that earned it. Empty for Base Case, a snapshot, or when
 *  either side couldn't be projected. */
export function scenarioMatches(f: PlanFacts): ReportSuggestion[] {
  const s = f.scenario;
  // No change type, no story: a scenario of no-op edits brings up nothing.
  if (!s || !f.projected || !s.base || Object.keys(s.changes).length === 0) return [];
  const topics: Array<[ScenarioTopic, ChangeDetail]> = [
    ...(Object.entries(s.changes) as Array<[ChangeType, ChangeDetail]>),
    ["anyChange", { count: s.changeCount }],
  ];
  const out: ReportSuggestion[] = [];
  for (const [topic, d] of topics) {
    const c: ScenarioContext = { f, s, p: f.projected, b: s.base, d, name: `“${s.name}”` };
    for (const [pageId, rule] of Object.entries(SCENARIO_RULES[topic]) as Array<[PresentationPageId, ScenarioRule]>) {
      const m = rule(c);
      if (m) out.push({ pageId, ...m, changeType: topic });
    }
  }
  return out;
}
