// "Roth Conversion Strategy" — the plan's own Roth conversions, against the
// same plan with every one of them removed.
//
// The counterfactual is DERIVED at export (`requiredDerivedRefs`), never a
// scenario the advisor built: a scenario that also moved a retirement date or a
// spending line would fold that change into every number this page prints, and
// the page would credit the conversions with it.
//
// "Better off" is measured by what the heirs receive after tax — the one figure
// that prices a pre-tax dollar and a Roth dollar differently. Ending portfolio
// does not: it counts a dollar still owing income tax as a whole dollar, so the
// tax a conversion prepays reads as pure loss.

import { derivedKey, type DerivedRefRequest } from "@/lib/presentations/derived-refs";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import { estateDistributionAtYear } from "@/lib/estate/estate-distribution-at-year";
import { assetsByTaxTypeAt } from "@/lib/presentations/shared/tax-type-composition";
import { buildTaxBracketRows } from "@/lib/tax/bracket";
import { exactCurrency, percentLabel } from "@/lib/presentations/format";
import { describeConversion } from "./strategy-text";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import type { BuildDataContext } from "@/components/presentations/registry";
import type {
  LifetimeRow,
  RothBreakeven,
  RothConversionPageData,
  RothConversionPageOptions,
  RothConversionTotals,
  RothConversionYearRow,
} from "./types";

export const ROTH_CONVERSION_PAGE_ID = "rothConversion";
export const ROTH_WITHOUT_KEY = "without";

// One line on the page, on purpose: it heads both sheets.
const COMPARISON_NOTE =
  "Compared with the same plan without these Roth conversions: same income, spending, retirement dates and returns.";

/** Below this, a dollar change is not worth a sentence. */
const MATERIAL = 500;

/** The counterfactual: every conversion in the plan removed. Switched-off ones
 *  too — the engine already skips them, so removing them changes nothing. */
export function withoutConversionsMutations(data: ClientData): SolverMutation[] {
  return (data.rothConversions ?? []).map((c) => ({
    kind: "roth-conversion-upsert",
    id: c.id,
    value: null,
  }));
}

/** The one variant this page asks the export for. A factory, because the
 *  conversion ids live in the chosen plan's tree. */
export function withoutConversionsRef(o: RothConversionPageOptions): DerivedRefRequest {
  return {
    key: ROTH_WITHOUT_KEY,
    from: o.scenarioId,
    label: "Without Roth conversions",
    mutations: (source) => withoutConversionsMutations(source.clientData),
  };
}

type EmptyReason = "no-conversions" | "irmaa" | "sources" | "nothing-converted" | "no-variant";

const EMPTY_COPY: Record<EmptyReason, string> = {
  "no-conversions": "This plan has no Roth conversions, so there is nothing to compare.",
  irmaa:
    "This plan's Roth conversions don't convert anything: the Medicare surcharge limit set on them leaves no room in any year.",
  sources:
    "This plan's Roth conversions don't convert anything: the accounts they draw from are empty by the time they start.",
  "nothing-converted": "This plan's Roth conversions don't convert anything in the years they are set to run.",
  "no-variant": "This comparison could not be built for this plan.",
};

function empty(planLabel: string, reason: EmptyReason): RothConversionPageData {
  return {
    planLabel,
    comparisonNote: COMPARISON_NOTE,
    emptyMessage: EMPTY_COPY[reason],
    strategy: [],
    totals: null,
    breakeven: null,
    takeaway: [],
    schedule: [],
    showTaxable: false,
    showBracket: false,
    advantage: [],
    lifetime: [],
    mix: null,
    rmd: null,
    footnotes: [],
  };
}

export function buildRothConversionData(
  ctx: BuildDataContext,
  options: RothConversionPageOptions,
): RothConversionPageData {
  const withBundle = ctx.bundlesByRef?.[keyForRef(resolveScenarioRef(options.scenarioId))];
  const withoutBundle = ctx.bundlesByRef?.[derivedKey(ROTH_CONVERSION_PAGE_ID, ROTH_WITHOUT_KEY)];
  if (!withBundle || !withoutBundle) return empty(withBundle?.scenarioLabel ?? "", "no-variant");

  const ownerNames = { clientName: ctx.clientName, spouseName: ctx.spouseName };
  const toPlan = (b: typeof withBundle): ConversionPlan => ({
    clientData: b.clientData,
    years: b.projection.years,
    heirsAt: (year) =>
      estateDistributionAtYear({ projection: b.projection, year, clientData: b.clientData, ownerNames })
        .toHeirs,
  });
  return buildRothConversionComparison({
    planLabel: withBundle.scenarioLabel,
    withPlan: toPlan(withBundle),
    withoutPlan: toPlan(withoutBundle),
  });
}

export interface ConversionPlan {
  clientData: ClientData;
  years: ProjectionYear[];
  /** What the heirs would receive after tax if the plan ended in `year`. */
  heirsAt: (year: number) => number;
}

const grossOf = (y: ProjectionYear) => (y.rothConversions ?? []).reduce((s, c) => s + c.gross, 0);
const taxOf = (y: ProjectionYear | undefined) => y?.taxResult?.flow.totalTax ?? 0;
const irmaaOf = (y: ProjectionYear | undefined) => y?.medicare?.totalIrmaaSurcharge ?? 0;
const rmdOf = (y: ProjectionYear) =>
  Object.values(y.accountLedgers ?? {}).reduce((s, l) => s + (l.rmdAmount ?? 0), 0);
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

export function buildRothConversionComparison(input: {
  planLabel: string;
  withPlan: ConversionPlan;
  withoutPlan: ConversionPlan;
}): RothConversionPageData {
  const { planLabel, withPlan, withoutPlan } = input;
  const conversions = (withPlan.clientData.rothConversions ?? []).filter((c) => c.enabled !== false);
  if (conversions.length === 0) return empty(planLabel, "no-conversions");

  const withoutByYear = new Map(withoutPlan.years.map((y) => [y.year, y]));
  const withByYear = new Map(withPlan.years.map((y) => [y.year, y]));
  const common = withPlan.years.filter((y) => withoutByYear.has(y.year));
  // The same year without the conversions — always there for a `common` year.
  const without = (y: ProjectionYear) => withoutByYear.get(y.year)!;
  const convYears = common.filter((y) => grossOf(y) > 0);
  if (convYears.length === 0) return empty(planLabel, nothingConvertedReason(common));

  const convSet = new Set(convYears.map((y) => y.year));
  const firstYear = convYears[0].year;
  const lastYear = convYears[convYears.length - 1].year;
  const taxDelta = (y: ProjectionYear) => taxOf(y) - taxOf(without(y));

  // ── Year-by-year ──
  const bracketMode = withPlan.clientData.planSettings.taxEngineMode === "bracket";
  const bracketByYear = bracketMode
    ? new Map(buildTaxBracketRows(withPlan.years).map((r) => [r.year, r]))
    : null;
  const schedule: RothConversionYearRow[] = convYears.map((y) => {
    const entries = y.rothConversions ?? [];
    const bracketRow = bracketByYear?.get(y.year);
    // IRMAA bills on the MAGI of two years earlier, so the surcharge this
    // year's conversion causes lands in year + 2.
    const later = y.year + 2;
    const laterWith = withByYear.get(later);
    const laterWithout = withoutByYear.get(later);
    const enrolledLater = laterWith?.medicare != null || laterWithout?.medicare != null;
    return {
      year: y.year,
      clientAge: y.ages.client,
      spouseAge: y.ages.spouse ?? null,
      converted: grossOf(y),
      taxable: sum(entries.map((c) => c.taxable)),
      extraTax: taxDelta(y),
      bracket: bracketRow ? (bracketRow.amtApplies ? "amt" : bracketRow.marginalRate) : null,
      extraMedicare: enrolledLater ? irmaaOf(laterWith) - irmaaOf(laterWithout) : null,
      note: entries.some((c) => c.limitedBy === "irmaa")
        ? "Held under the Medicare limit"
        : entries.some((c) => c.limitedBy === "sources")
          ? "Account emptied"
          : null,
    };
  });

  // ── Totals ──
  const heirs = common
    .filter((y) => y.year >= firstYear)
    .map((y) => ({ year: y.year, with: withPlan.heirsAt(y.year), without: withoutPlan.heirsAt(y.year) }));
  const advantage = heirs.map((h) => ({ year: h.year, value: h.with - h.without }));
  // The plan's last year: the conversions start inside the plan, so it is here.
  const atEnd = heirs[heirs.length - 1];
  const medicareWith = sum(common.map(irmaaOf));
  const medicareWithout = sum(common.map((y) => irmaaOf(without(y))));
  const totals = {
    converted: sum(schedule.map((r) => r.converted)),
    extraTax: sum(convYears.map(taxDelta)),
    laterTaxSaved: -sum(common.filter((y) => !convSet.has(y.year)).map(taxDelta)),
    extraMedicare: medicareWith - medicareWithout,
    heirsChange: atEnd.with - atEnd.without,
  };
  const breakeven = findBreakeven(advantage);

  // ── Side by side ──
  const lifetime: LifetimeRow[] = [
    {
      // `totalTax` carries payroll tax too, so not "income tax" — the
      // conversions never move payroll tax, so the change is the same either way.
      label: "Tax over the plan",
      without: sum(common.map((y) => taxOf(without(y)))),
      with: sum(common.map(taxOf)),
      betterIsLower: true,
    },
  ];
  if (medicareWith > 0 || medicareWithout > 0) {
    lifetime.push({ label: "Medicare surcharges", without: medicareWithout, with: medicareWith, betterIsLower: true });
  }
  lifetime.push({ label: "Heirs receive, after tax", without: atEnd.without, with: atEnd.with, betterIsLower: false });

  const endWith = common[common.length - 1];
  const mix = {
    year: endWith.year,
    with: assetsByTaxTypeAt(endWith, withPlan.clientData.accounts),
    without: assetsByTaxTypeAt(without(endWith), withoutPlan.clientData.accounts),
  };

  const firstRmdYear = common.find((y) => rmdOf(y) > 0 || rmdOf(without(y)) > 0);
  const rmd = firstRmdYear
    ? {
        year: firstRmdYear.year,
        clientAge: firstRmdYear.ages.client,
        with: rmdOf(firstRmdYear),
        without: rmdOf(without(firstRmdYear)),
      }
    : null;
  if (rmd) {
    lifetime.push({
      label: `Required withdrawal, ${rmd.year} (age ${rmd.clientAge})`,
      without: rmd.without,
      with: rmd.with,
      betterIsLower: true,
    });
  }

  // ── Words ──
  const strategy = conversions.flatMap((conv) => {
    const ran = common.filter((y) => (y.rothConversions ?? []).some((c) => c.id === conv.id && c.gross > 0));
    if (ran.length === 0) return [];
    return [
      describeConversion(conv, {
        accounts: withPlan.clientData.accounts,
        firstYear: ran[0].year,
        lastYear: ran[ran.length - 1].year,
      }),
    ];
  });

  return {
    planLabel,
    comparisonNote: COMPARISON_NOTE,
    emptyMessage: null,
    strategy,
    totals,
    breakeven,
    takeaway: buildTakeaway(totals, { firstYear, lastYear }, breakeven, rmd != null && rmd.with < rmd.without),
    schedule,
    showTaxable: schedule.some((r) => Math.abs(r.taxable - r.converted) >= 1),
    showBracket: bracketMode,
    advantage,
    lifetime,
    mix,
    rmd,
    footnotes: buildFootnotes(withPlan.clientData, bracketMode),
  };
}

function nothingConvertedReason(years: ProjectionYear[]): EmptyReason {
  const entries = years.flatMap((y) => y.rothConversions ?? []);
  if (entries.some((c) => c.limitedBy === "irmaa")) return "irmaa";
  if (entries.some((c) => c.limitedBy === "sources")) return "sources";
  return "nothing-converted";
}

/** The year after the last one the family is behind in. Behind means more than
 *  a dollar behind — a rounding difference is not a loss. */
function findBreakeven(advantage: Array<{ year: number; value: number }>): RothBreakeven {
  const lastBehind = advantage.findLastIndex((p) => p.value < -1);
  if (lastBehind < 0) return { kind: "immediate" };
  const next = advantage[lastBehind + 1];
  return next ? { kind: "year", year: next.year } : { kind: "never" };
}

/** Thousands above $10,000, hundreds below: "about $33,000", "about $4,800". */
function about(n: number): string {
  const a = Math.abs(n);
  return exactCurrency(a >= 10_000 ? Math.round(a / 1_000) * 1_000 : Math.round(a / 100) * 100);
}

function buildTakeaway(
  t: RothConversionTotals,
  { firstYear, lastYear }: { firstYear: number; lastYear: number },
  breakeven: RothBreakeven,
  rmdSmaller: boolean,
): string[] {
  const out: string[] = [];
  const when = firstYear === lastYear ? `in ${firstYear}` : `from ${firstYear} through ${lastYear}`;
  const inThose = firstYear === lastYear ? "that year" : "those years";
  out.push(
    t.extraTax >= MATERIAL
      ? `Converting ${about(t.converted)} to Roth ${when} adds about ${about(t.extraTax)} to your tax bill in ${inThose}.`
      : `Converting ${about(t.converted)} to Roth ${when} adds little or no tax in ${inThose}.`,
  );

  if (t.laterTaxSaved >= MATERIAL) {
    out.push(
      `Afterward your taxes run lower, about ${about(t.laterTaxSaved)} less over the rest of the plan${
        rmdSmaller ? ", largely because required withdrawals are smaller" : ""
      }.`,
    );
  } else if (t.laterTaxSaved <= -MATERIAL) {
    out.push(`Taxes after the conversions also run about ${about(t.laterTaxSaved)} higher over the rest of the plan.`);
  }

  if (t.extraMedicare >= MATERIAL) {
    out.push(`The higher income also adds about ${about(t.extraMedicare)} in Medicare surcharges.`);
  } else if (t.extraMedicare <= -MATERIAL) {
    out.push(`Lower income later also saves about ${about(t.extraMedicare)} in Medicare surcharges.`);
  }

  if (Math.abs(t.heirsChange) < MATERIAL) {
    out.push("By the end of the plan, your heirs receive about the same after tax either way.");
  } else if (breakeven.kind === "never") {
    out.push(
      `Within this plan, the conversions don't pay for themselves: your heirs receive about ${about(t.heirsChange)} less after tax.`,
    );
  } else {
    const lead =
      breakeven.kind === "immediate"
        ? "Your family comes out ahead from the first conversion on"
        : `From ${breakeven.year} on, your family comes out ahead`;
    out.push(`${lead}: by the end of the plan, your heirs receive about ${about(t.heirsChange)} more after tax.`);
  }
  return out;
}

function buildFootnotes(data: ClientData, bracketMode: boolean): string[] {
  const ird = data.planSettings.irdTaxRate ?? 0;
  const notes = [
    ird > 0
      ? `“Heirs receive” is what passes to your family after taxes and estate costs, including the ${percentLabel(ird)} income tax heirs are assumed to pay when they withdraw from an inherited pre-tax account.`
      : "“Heirs receive” is what passes to your family after taxes and estate costs. This plan assumes heirs pay no income tax on inherited pre-tax accounts, which understates the benefit of converting.",
    "Break-even is the first year from which your heirs would receive more after tax with the conversions than without.",
  ];
  if (!bracketMode) notes.push("This plan uses a flat tax rate, so every conversion is taxed at that rate.");
  notes.push("All amounts are in future dollars.");
  return notes;
}
