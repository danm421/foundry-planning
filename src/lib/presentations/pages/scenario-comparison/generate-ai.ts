// Server-side generator for the Scenario Comparison page's per-scenario
// tradeoff narratives, plus the loader that assembles the data it reads.
//
// This is the ONE module in src/lib/presentations/ that performs IO — the rest
// of the page (view model, metrics, bands, prompt, page-count estimate) is pure
// and unit-testable without a database. Auth, rate limiting and audit stay with
// the callers (the scenario-comparison-ai route and ensure-ai-summaries).
//
// Two halves, deliberately separate:
//   prepareScenarioComparisonAiInputs — loads base + each chosen scenario ONCE
//     and runs the page's own view model over them, so the narratives are
//     written against exactly the gains, costs and change lines the sheet
//     prints.
//   generateScenarioComparisonAi — prompt → Redis → ONE structured LLM call for
//     every band on the sheet, returning only the bands that went stale.
//
// Unlike the Retirement Comparison generator, which loads and projects its own
// pair on every call, the model call here takes already-built data: one load
// per page, not one per band.

import { inArray } from "drizzle-orm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { chatModel } from "@/domain/forge/llm";
import { runProjectionWithEvents } from "@/engine/projection";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import {
  keyForRef,
  labelForRef,
  resolveScenarioRef,
} from "@/lib/scenario/presentation-refs";
import {
  applyReinvestmentEnrichment,
  buildAssetTxResolveData,
  buildBaseResolveData,
  buildReinvestmentEnrichmentDeps,
  hasReinvestmentChange,
} from "@/lib/scenario/scenario-changes-resolve";
import { listInvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import {
  hashAiRequest,
  getCachedAnalysis,
  setCachedAnalysis,
} from "@/lib/presentations/ai-cache";
import type { PageScenarioBundle } from "@/components/presentations/document";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";
import type { MaxSpendResult } from "@/lib/solver/solve-max-spending";
import {
  buildScenarioComparisonAiPrompt,
  hashBand,
  NarrativesSchema,
  type Narratives,
} from "./ai-prompt";
import { buildScenarioComparisonData, narrativeSentenceBudget } from "./view-model";
import type {
  ColumnHeader,
  MetricRow,
  ScenarioComparisonOptions,
  TradeoffBand,
} from "./types";

// ── the model call ──────────────────────────────────────────────────────────

/** What the page already holds for one band. Structurally a subset of
 *  `ScenarioComparisonBandAi`, so page options can be passed straight in. */
export interface StoredBandNarrative {
  generatedText: string;
  sourceHash: string | null;
}

export interface GeneratedBandNarrative {
  markdown: string;
  generatedAt: string;
  /** THIS band's own `hashBand` value — what the caller stores as sourceHash. */
  hash: string;
}

export interface GenerateScenarioComparisonAiArgs {
  /** Redis cache namespace. */
  clientId: string;
  householdName: string;
  firstNames: string;
  /** Base Case first, index-aligned with each row's cells. */
  columns: ColumnHeader[];
  rows: MetricRow[];
  /** Every band on the sheet. Fresh ones are still prompted (so the model can
   *  contrast them) but never returned. */
  bands: TradeoffBand[];
  tone: ScenarioComparisonOptions["ai"]["tone"];
  customInstructions: string;
  sentenceBudget: number;
  /** Keyed by scenario id, as the page stores it. */
  stored: Record<string, StoredBandNarrative>;
  /** Treat every band as stale and bypass the Redis read. */
  force: boolean;
}

export interface GeneratedScenarioComparisonAi {
  /** Only the bands that were stale AND that the model answered for. */
  byScenario: Record<string, GeneratedBandNarrative>;
  /** True when no LLM call was made — nothing stale, or a Redis hit. */
  cached: boolean;
}

/** One line per metric row, naming every column. Indented sub-rows keep their
 *  relationship to the total above them ("of which federal"), which a bare
 *  "federal" label would lose once the row is flattened into prose. */
function matrixLinesFrom(columns: ColumnHeader[], rows: MetricRow[]): string[] {
  return rows.map((row) => {
    const cells = row.cells
      .map((cell, i) => {
        const name = columns[i]?.name ?? `Column ${i + 1}`;
        return cell.delta ? `${name} ${cell.value} (${cell.delta})` : `${name} ${cell.value}`;
      })
      .join("; ");
    return `${row.indent ? "of which " : ""}${row.label}: ${cells}`;
  });
}

/** Read a cached response back. The cache stores the whole narrative set as
 *  JSON in its `markdown` slot; anything that no longer parses (a truncated
 *  value, a shape from an earlier prompt version) is treated as a miss rather
 *  than failing the export. */
function parseCachedNarratives(markdown: string): Narratives | null {
  try {
    const parsed = NarrativesSchema.safeParse(JSON.parse(markdown));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Write one paragraph per stale band in a single LLM call.
 *
 * Staleness is per band — a band is stale when its own `hashBand` differs from
 * the stored `sourceHash`, or when it has no stored text at all. That is what
 * lets one scenario's numbers move without discarding the advisor's edits on
 * the other two.
 *
 * Errors are logged and rethrown: the caller decides whether a failure is fatal
 * (the route surfaces it) or best-effort (the export keeps the existing text).
 */
export async function generateScenarioComparisonAi(
  args: GenerateScenarioComparisonAiArgs,
): Promise<GeneratedScenarioComparisonAi> {
  const { bands, stored, force } = args;

  const hashes = new Map<string, string>(
    bands.map((b) => [
      b.scenarioId,
      hashBand({
        scenarioId: b.scenarioId,
        gains: b.gains,
        costs: b.costs,
        changeLines: b.changeLines,
        tone: args.tone,
        customInstructions: args.customInstructions,
        sentenceBudget: args.sentenceBudget,
      }),
    ]),
  );

  const staleIds = new Set(
    bands
      .filter((b) => {
        if (force) return true;
        const s = stored[b.scenarioId];
        return hashes.get(b.scenarioId) !== s?.sourceHash || !s?.generatedText;
      })
      .map((b) => b.scenarioId),
  );

  // Nothing moved: no Redis read, no Azure call, nothing for the caller to
  // merge. The common case on a re-export of an unchanged deck.
  if (staleIds.size === 0) return { byScenario: {}, cached: true };

  const { system, user } = buildScenarioComparisonAiPrompt({
    householdName: args.householdName,
    firstNames: args.firstNames,
    tone: args.tone,
    customInstructions: args.customInstructions,
    sentenceBudget: args.sentenceBudget,
    bands,
    matrixLines: matrixLinesFrom(args.columns, args.rows),
  });

  // The prompt hash is still the right CACHE key even though the STALENESS key
  // is per band: the same prompt always yields the same set of paragraphs.
  const promptHash = hashAiRequest({ system, user });

  let narratives: Narratives | null = null;
  let generatedAt = "";
  let cached = false;

  if (!force) {
    const hit = await getCachedAnalysis(args.clientId, promptHash);
    const parsed = hit ? parseCachedNarratives(hit.markdown) : null;
    if (hit && parsed) {
      narratives = parsed;
      generatedAt = hit.generatedAt;
      cached = true;
    }
  }

  if (!narratives) {
    try {
      const model = (await chatModel("full")).withStructuredOutput(NarrativesSchema, {
        name: "scenario_comparison_narratives",
      });
      narratives = (await model.invoke([
        new SystemMessage(system),
        new HumanMessage(user),
      ])) as Narratives;
    } catch (err) {
      console.error("[scenario-comparison-ai] generation failed", err);
      throw err;
    }
    generatedAt = new Date().toISOString();
    await setCachedAnalysis(args.clientId, promptHash, {
      markdown: JSON.stringify(narratives),
      generatedAt,
    });
  }

  // Match by scenarioId, never by array position. A positional match prints one
  // scenario's narrative under another scenario's heading, and every number on
  // the page still looks plausible. Mirrors dropUncitedActions in
  // src/lib/insights/generate.ts.
  const known = new Set(bands.map((b) => b.scenarioId));
  const paragraphById = new Map<string, string>();
  for (const n of narratives.narratives) {
    if (!known.has(n.scenarioId)) {
      console.warn(
        `[scenario-comparison-ai] dropped narrative for unknown scenarioId: ${n.scenarioId}`,
      );
      continue;
    }
    if (paragraphById.has(n.scenarioId)) {
      console.warn(
        `[scenario-comparison-ai] dropped duplicate narrative for scenarioId: ${n.scenarioId}`,
      );
      continue;
    }
    paragraphById.set(n.scenarioId, n.paragraph.trim());
  }

  const byScenario: Record<string, GeneratedBandNarrative> = {};
  for (const b of bands) {
    if (!staleIds.has(b.scenarioId)) continue;
    const markdown = paragraphById.get(b.scenarioId);
    // A band the model skipped — or answered with nothing — is left out
    // entirely, so the caller keeps whatever text that band already had rather
    // than blanking it. Storing an empty paragraph against a matching hash
    // would also read as stale on the very next export and pay for the call
    // again, every time.
    if (!markdown) continue;
    byScenario[b.scenarioId] = { markdown, generatedAt, hash: hashes.get(b.scenarioId)! };
  }

  return { byScenario, cached };
}

// ── the loader ──────────────────────────────────────────────────────────────

/** Everything `generateScenarioComparisonAi` needs that has to be loaded. */
export interface ScenarioComparisonAiInputs {
  householdName: string;
  firstNames: string;
  /** Set by the column count, not by an advisor preference — see view-model. */
  sentenceBudget: number;
  columns: ColumnHeader[];
  rows: MetricRow[];
  bands: TradeoffBand[];
}

/** Build one bundle per column, the way the export route does. Monte Carlo and
 *  max-spend both read through the compute cache, so the render pass that
 *  follows reuses these results instead of re-solving them. */
async function loadBundle(
  clientId: string,
  firmId: string,
  raw: string,
  options: ScenarioComparisonOptions,
  scenarioNames: Map<string, string>,
  getInvestmentCatalog: () => ReturnType<typeof listInvestmentOptionCatalog>,
): Promise<PageScenarioBundle> {
  const ref = resolveScenarioRef(raw);
  const scenarioId = ref.kind === "scenario" ? ref.id : "base";
  const { effectiveTree } = await loadEffectiveTreeForRef(clientId, firmId, ref);
  const projection = runProjectionWithEvents(effectiveTree);

  // Every unavailable input degrades to a dash on the sheet rather than
  // failing the deck, so each is caught independently.
  let monteCarlo: MonteCarloReportPayload | null = null;
  try {
    monteCarlo = (await getOrComputeMonteCarlo({ clientId, firmId, scenarioId })).payload;
  } catch (err) {
    console.error("[scenario-comparison-ai] Monte Carlo unavailable", err);
  }

  let maxSpend: MaxSpendResult | null = null;
  if (options.maxSpend.show && ref.kind === "scenario") {
    try {
      maxSpend = await getOrComputeMaxSpending({
        clientId,
        firmId,
        scenarioId: ref.id,
        targetPoS: options.maxSpend.targetConfidence,
      });
    } catch (err) {
      console.error("[scenario-comparison-ai] max-spend solve failed", err);
    }
  }

  // Change lines for the band come from here. Base Case has no change set.
  //
  // Org scoping: loadScenarioChanges reads by scenarioId alone; ownership was
  // proven by the loadEffectiveTreeForRef call above, which throws on a
  // cross-org id. Do not reorder these.
  let scenarioChanges: ScenarioChangesContext | undefined;
  if (ref.kind === "scenario" && ref.id !== "base") {
    try {
      const [changes, toggleGroups] = await Promise.all([
        loadScenarioChanges(ref.id),
        loadScenarioToggleGroups(ref.id),
      ]);
      let resolve = buildBaseResolveData(effectiveTree);
      // Reinvestment enrichment names the NEW model portfolio in the change
      // line. Kept in step with the same block in render-presentation-pdf.ts:
      // without it the narrative would describe a switch the sheet beside it
      // names, in vaguer words.
      if (hasReinvestmentChange(changes)) {
        try {
          const catalog = await getInvestmentCatalog();
          resolve = applyReinvestmentEnrichment(
            resolve,
            buildReinvestmentEnrichmentDeps(
              changes,
              Object.fromEntries(catalog.portfolios.map((p) => [p.id, p.name] as const)),
              effectiveTree.reinvestments ?? [],
            ),
          );
        } catch (riErr) {
          console.error("[scenario-comparison-ai] reinvestment enrichment failed", riErr);
        }
      }
      resolve = { ...resolve, assetTxById: buildAssetTxResolveData(projection.years) };
      scenarioChanges = {
        changes,
        toggleGroups,
        targetNames: buildTargetNames(effectiveTree, clientId),
        baseLabel: "your current plan",
        resolve,
      };
    } catch (err) {
      console.error("[scenario-comparison-ai] scenario changes load failed", err);
    }
  }

  return {
    clientData: effectiveTree,
    projection,
    scenarioLabel: labelForRef(ref, scenarioNames),
    monteCarlo,
    scenarioChanges,
    maxSpend,
  };
}

/**
 * Load Base Case plus each chosen scenario and run the page's own view model
 * over them, so the AI is handed exactly the gains, costs and change lines the
 * sheet will print.
 *
 * Returns null when the page has nothing to narrate — an unresolvable scenario
 * set, or bands switched off. Throws on a load failure; callers decide.
 */
export async function prepareScenarioComparisonAiInputs(
  clientId: string,
  firmId: string,
  options: ScenarioComparisonOptions,
): Promise<ScenarioComparisonAiInputs | null> {
  // The same ref set the registry's `requiredScenarioRefs` declares: Base Case
  // plus each distinct chosen scenario, in the advisor's order.
  const rawRefs = ["base", ...new Set(options.scenarioIds.filter(Boolean))];

  const liveIds = rawRefs
    .map((raw) => resolveScenarioRef(raw))
    .filter((ref) => ref.kind === "scenario" && ref.id !== "base")
    .map((ref) => ref.id);
  const scenarioNames = new Map<string, string>();
  if (liveIds.length > 0) {
    const rows = await db
      .select({ id: scenarios.id, name: scenarios.name })
      .from(scenarios)
      .where(inArray(scenarios.id, liveIds));
    for (const r of rows) scenarioNames.set(r.id, r.name);
  }

  // Memoized across the columns: the catalog is a multi-query bundle load and
  // several scenarios may each carry a reinvestment change.
  let investmentCatalog: ReturnType<typeof listInvestmentOptionCatalog> | null = null;
  const getInvestmentCatalog = () =>
    (investmentCatalog ??= listInvestmentOptionCatalog(clientId, firmId));

  const built = await Promise.all(
    rawRefs.map(async (raw) => ({
      key: keyForRef(resolveScenarioRef(raw)),
      bundle: await loadBundle(clientId, firmId, raw, options, scenarioNames, getInvestmentCatalog),
    })),
  );
  const bundlesByRef: Record<string, PageScenarioBundle> = {};
  for (const b of built) bundlesByRef[b.key] = b.bundle;

  const baseBundle = bundlesByRef[keyForRef(resolveScenarioRef("base"))];
  const ci = baseBundle.clientData.client;

  // Only the fields buildScenarioComparisonData reads are real; the rest is PDF
  // page chrome this path never renders. Same stubbing contract as
  // buildSolverSummaryContext (src/lib/solver/summary-context.ts).
  const ctx: BuildDataContext = {
    years: baseBundle.projection.years,
    projection: baseBundle.projection,
    clientData: baseBundle.clientData,
    scenarioLabel: baseBundle.scenarioLabel,
    clientName: `${ci.firstName} ${ci.lastName ?? ""}`.trim(),
    spouseName: ci.spouseName ?? null,
    spouseLastName: null,
    firmName: "",
    firmTagline: null,
    reportDate: "",
    firmLogoDataUrl: null,
    accentColor: "",
    bundlesByRef,
  };

  const data = buildScenarioComparisonData(ctx, options);
  if (data.bands.length === 0) return null;

  const firstName = ci.firstName || "the household";
  const spouseFirst = ci.spouseName ?? null;

  return {
    householdName: `the ${ci.lastName ?? firstName} household`,
    firstNames: spouseFirst ? `${firstName} and ${spouseFirst}` : firstName,
    // The view model sizes the budget off the number of scenario columns; read
    // it the same way or the truncation on render would cut text the model was
    // told it could write.
    sentenceBudget: narrativeSentenceBudget(data.columns.length - 1),
    columns: data.columns,
    rows: data.rows,
    bands: data.bands,
  };
}
