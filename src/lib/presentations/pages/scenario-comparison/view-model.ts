import type { ProjectionYear } from "@/engine";
import type { PageScenarioBundle } from "@/components/presentations/document";
import type { BuildDataContext } from "@/components/presentations/registry";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-data";
import { yearsFullyFunded, netToHeirsEol } from "@/lib/solver/solver-summary-metrics";
import { computeLifetimeTotals } from "@/lib/presentations/pages/tax-summary/aggregate";
import { retirementYearOf } from "@/lib/presentations/pages/retirement-summary/aggregate";
import { describeChange } from "@/lib/presentations/pages/scenario-changes/describe";
import { groupUnits } from "@/lib/presentations/pages/scenario-changes/group";
import {
  buildResolveContext,
  EMPTY_RESOLVE_DATA,
} from "@/lib/presentations/pages/scenario-changes/describe/resolve";
import { dataLight } from "@/brand";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { buildMetricRows, type ScenarioColumnInput } from "./metrics";
import { buildBadges } from "./badges";
import { buildTradeoffBands } from "./bands";
import { buildComparisonChartSpec, type ComparisonSeries } from "./chart-spec";
import type {
  ScenarioComparisonOptions,
  ScenarioComparisonPageData,
  ColumnHeader,
} from "./types";

/** Base Case is grey — the neutral reference the coloured alternatives read
 *  against. Columns 2-4 take Deep Jewel hues in a fixed order so a scenario
 *  keeps the same colour across the cards, the matrix, the chart and its band. */
export const COLUMN_COLORS = [T.ink3, dataLight.blue, dataLight.teal, dataLight.purple];

const CHART_WIDTH = 526;
const CHART_HEIGHT = 190;

/** Sentence budget per band. Sheet two holds up to three bands in 666pt, so the
 *  budget shrinks as columns are added. This is a layout constraint, not an
 *  advisor preference — which is why there is no `length` option. */
export function narrativeSentenceBudget(scenarioCount: number): number {
  if (scenarioCount <= 1) return 6;
  if (scenarioCount === 2) return 4;
  return 3;
}

/** Cut at a sentence boundary at or before `max`. The renderer also clamps with
 *  a `maxLines` STYLE, but truncating here is what keeps the page-count
 *  estimator and the renderer measuring the same string.
 *
 *  A sentence ends at a terminator followed by whitespace or the end of the
 *  text — the "." in "$1.2M" is not one. The cut is made by SLICING at that
 *  offset rather than by concatenating regex matches: a match cannot span a
 *  decimal, so the words ahead of one land in no match at all and joining the
 *  matches silently amputates the opening of the narrative. `compactCurrency`
 *  prints exactly that "$1.2M" shape, so narratives naming a dollar figure are
 *  the norm here, not an edge case. */
export function truncateToSentences(text: string, max: number): string {
  const trimmed = text.trim();
  const ends: number[] = [];
  const terminator = /[.!?](?=\s|$)/g;
  for (let m = terminator.exec(trimmed); m !== null; m = terminator.exec(trimmed)) {
    ends.push(m.index);
  }
  if (ends.length <= max) return trimmed;
  return trimmed.slice(0, ends[max - 1] + 1);
}

function empty(): ScenarioComparisonPageData {
  return {
    title: "Scenario Comparison",
    subtitle: "",
    isEmpty: true,
    columns: [], rows: [], chart: null, bands: [],
    footnote: "",
  };
}

/** Plain-English change lines for one bundle, reusing the Plan Comparison
 *  describers unchanged. Returns [] when the bundle carries no change set. */
function changeLinesFor(bundle: PageScenarioBundle): string[] {
  const sc = bundle.scenarioChanges;
  if (!sc || sc.changes.length === 0) return [];
  const resolve = buildResolveContext(sc.resolve ?? EMPTY_RESOLVE_DATA);
  const described = sc.changes.map((change) => ({
    change,
    row: describeChange(change, { targetNames: sc.targetNames, resolve }),
  }));
  return groupUnits(described, sc.toggleGroups).map((u) =>
    u.kind === "group" ? u.label : u.row.what,
  );
}

/** The projection row that stands for retirement, CLAMPED onto the plan's own
 *  span.
 *
 *  `ClientInfo` carries no `retirementYear` field — it is derived from
 *  dateOfBirth + retirementAge, and can land outside the projection entirely
 *  (an already-retired client, a missing or unparseable date of birth). Both
 *  out-of-range cases clamp: below the plan → the first year, above it → the
 *  last. Falling back to the LAST year instead would print "Assets at
 *  retirement" as the end-of-life figure — byte-identical to the row directly
 *  beneath it — and stand the dashed rule on the final plotted year. The
 *  first-year fallback is the deck's established convention, set by the sibling
 *  Retirement Summary page's `retirementYearRow`.
 *
 *  Resolving it once, here, is also what keeps the matrix's "assets at
 *  retirement" and the chart's retirement marker on the same year, and keeps
 *  the marker on a year the chart actually plots — an off-domain marker has no
 *  band to stand on, so the renderer pins it to the left edge. */
function retirementRow(bundle: PageScenarioBundle): ProjectionYear {
  const years = bundle.projection.years;
  const first = years[0];
  const last = years[years.length - 1];
  const wanted = retirementYearOf(bundle.clientData);
  if (wanted == null || wanted <= first.year) return first;
  if (wanted >= last.year) return last;
  return years.find((y) => y.year === wanted) ?? first;
}

function columnInputFor(
  refKey: string,
  bundle: PageScenarioBundle,
  ctx: BuildDataContext,
): ScenarioColumnInput {
  const years = bundle.projection.years;
  const last = years[years.length - 1];
  const atRetirementRow = retirementRow(bundle);
  const tax = computeLifetimeTotals(years);
  const mc = bundle.monteCarlo?.summary ?? null;

  return {
    refKey,
    name: bundle.scenarioLabel,
    successRate: mc?.successRate ?? null,
    endingP20: mc?.ending.p20 ?? null,
    // liquidTotal — taxable + cash + retirement + life insurance + accessible
    // trust. NOT the engine's same-named helper, which omits the last two.
    atRetirement: liquidPortfolioTotal(atRetirementRow),
    atEndOfLife: liquidPortfolioTotal(last),
    retirementYear: atRetirementRow.year,
    endYear: last.year,
    lifetimeTaxTotal: tax.lifetimeTotal,
    lifetimeTaxFederal: tax.lifetimeFederal,
    lifetimeTaxState: tax.lifetimeState,
    // Deliberately the engine's narrower definition: this counts shortfall
    // years, not assets, and matches what the Solver reports.
    yearsFullyFunded: yearsFullyFunded(years),
    netToHeirs: netToHeirsEol(bundle.projection, bundle.clientData, {
      clientName: ctx.clientName,
      spouseName: ctx.spouseName,
    }),
    // MaxSpendResult's today's-dollar annual figure.
    maxSpendToday: bundle.maxSpend?.realAnnualSpend ?? null,
  };
}

/** Up to three short lines under a column's name: the first two change lines,
 *  then a "+N more" tail. */
function descriptorFrom(lines: string[]): string[] {
  if (lines.length === 0) return ["No changes recorded."];
  const head = lines.slice(0, 2);
  const rest = lines.length - head.length;
  return rest > 0 ? [...head, `+${rest} more`] : head;
}

function buildChart(
  resolved: Array<{ refKey: string; bundle: PageScenarioBundle }>,
  columns: ColumnHeader[],
) {
  // The union of every plan's years: two plans can run to different end years,
  // and truncating to the shortest would silently crop the longer plan's line.
  const years = [
    ...new Set(resolved.flatMap((r) => r.bundle.projection.years.map((y) => y.year))),
  ].sort((a, b) => a - b);

  const series: ComparisonSeries[] = resolved.map((r, i) => {
    const rows = r.bundle.projection.years;
    const byYear = new Map(rows.map((y) => [y.year, liquidPortfolioTotal(y)]));
    return {
      label: columns[i].name,
      color: columns[i].color,
      // A plan that ends early contributes a gap past its last year, never a
      // zero — a zero would draw a cliff the plan does not have.
      values: years.map((y) => byYear.get(y) ?? NaN),
      retirementYear: retirementRow(r.bundle).year,
    };
  });

  return buildComparisonChartSpec(years, series, CHART_WIDTH, CHART_HEIGHT);
}

export function buildScenarioComparisonData(
  ctx: BuildDataContext,
  options: ScenarioComparisonOptions,
): ScenarioComparisonPageData {
  const byRef = ctx.bundlesByRef ?? {};
  const baseBundle = byRef[keyForRef(resolveScenarioRef("base"))];
  // De-duplicate: planScenarioBundles collapses two identical refs into one
  // bundle, so a repeated id would otherwise print the same column twice under
  // two different headings.
  const ids = [...new Set(options.scenarioIds.filter(Boolean))];
  if (!baseBundle || ids.length === 0) return empty();

  const resolved: Array<{ refKey: string; bundle: PageScenarioBundle }> = [
    { refKey: "base", bundle: baseBundle },
  ];
  for (const id of ids) {
    const b = byRef[keyForRef(resolveScenarioRef(id))];
    if (b) resolved.push({ refKey: id, bundle: b });
  }
  if (resolved.length < 2) return empty();

  const columnInputs = resolved.map((r) => columnInputFor(r.refKey, r.bundle, ctx));
  const rows = buildMetricRows({ columns: columnInputs, showMaxSpend: options.maxSpend.show });
  const badges = buildBadges(rows, columnInputs.length);

  const changeLinesByScenario: Record<string, string[]> = {};
  for (const r of resolved.slice(1)) changeLinesByScenario[r.refKey] = changeLinesFor(r.bundle);

  const columns: ColumnHeader[] = columnInputs.map((c, i) => ({
    refKey: c.refKey,
    name: c.name,
    descriptor: i === 0
      ? ["Your plan as it stands today."]
      : descriptorFrom(changeLinesByScenario[c.refKey] ?? []),
    confidence: c.successRate,
    color: COLUMN_COLORS[i] ?? COLUMN_COLORS[COLUMN_COLORS.length - 1],
    badges: badges[i] ?? [],
  }));

  const budget = narrativeSentenceBudget(resolved.length - 1);
  const narrativesByScenario: Record<string, string> = {};
  for (const r of resolved.slice(1)) {
    const stored = options.ai.byScenario[r.refKey]?.generatedText ?? "";
    narrativesByScenario[r.refKey] = stored ? truncateToSentences(stored, budget) : "";
  }

  const bands = options.showTradeoffBands
    ? buildTradeoffBands({
        columns: columnInputs,
        rows,
        colors: columns.map((c) => c.color),
        changeLinesByScenario,
        narrativesByScenario,
      })
    : [];

  const chart = options.showChart ? buildChart(resolved, columns) : null;
  const mcMissing = columnInputs.some((c) => c.successRate == null);
  const n = resolved.length - 1;

  return {
    title: "Scenario Comparison",
    subtitle: `Base Case vs. ${n} alternative${n === 1 ? "" : "s"}`,
    isEmpty: false,
    columns, rows, chart, bands,
    footnote: mcMissing
      ? "Plan confidence and downside figures are unavailable for one or more plans; those cells show a dash."
      : "",
  };
}
