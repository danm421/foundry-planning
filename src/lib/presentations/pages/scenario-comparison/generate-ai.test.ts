import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ColumnHeader, MetricRow, TradeoffBand } from "./types";

// The chat model and the Redis cache are the only IO this module performs, and
// `vitest` loads `.env.local` in this repo — an unmocked `chatModel` would make
// a REAL Azure call. Mocked at module scope (not per test) so no path can slip
// past. Same hoisted shape as src/lib/insights/__tests__/generate-validation.
const invoke = vi.hoisted(() => vi.fn());
const withStructuredOutput = vi.hoisted(() =>
  vi.fn<(schema: unknown, opts?: unknown) => { invoke: typeof invoke }>(() => ({ invoke })),
);
const chatModel = vi.hoisted(() =>
  vi.fn<(tier: string) => { withStructuredOutput: typeof withStructuredOutput }>(() => ({
    withStructuredOutput,
  })),
);
vi.mock("@/domain/forge/llm", () => ({ chatModel }));

const getCachedAnalysis = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
const setCachedAnalysis = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/presentations/ai-cache", () => ({
  hashAiRequest: () => "PROMPT_HASH",
  getCachedAnalysis,
  setCachedAnalysis,
}));

// The module's other half loads the deck's columns. Its bundle building is the
// SHARED loader (covered in src/lib/scenario/__tests__/load-page-bundles.test.ts);
// stub it here so `prepareScenarioComparisonAiInputs` can be exercised over
// known bundles with no database behind it.
const loadPageScenarioBundles = vi.hoisted(() => vi.fn());
vi.mock("@/lib/scenario/load-page-bundles", () => ({ loadPageScenarioBundles }));
// Typed on the generic so `mock.calls[0][0]` is the solve request — the
// scenarioId it names is what the assertions below read.
const getOrComputeMaxSpending = vi.hoisted(() =>
  vi.fn<(args: { scenarioId: string }) => Promise<{ realAnnualSpend: number }>>(
    async () => ({ realAnnualSpend: 164_000 }),
  ),
);
vi.mock("@/lib/compute-cache/max-spending", () => ({ getOrComputeMaxSpending }));
vi.mock("@/lib/presentations/investment-option-catalog", () => ({
  listInvestmentOptionCatalog: vi.fn(async () => ({ portfolios: [] })),
}));

import {
  generateScenarioComparisonAi,
  prepareScenarioComparisonAiInputs,
  type GenerateScenarioComparisonAiArgs,
} from "./generate-ai";
import { hashBand } from "./ai-prompt";
import { narrativeSentenceBudget } from "./view-model";
import { SCENARIO_COMPARISON_OPTIONS_DEFAULT } from "./options-schema";
import type { ScenarioComparisonOptions } from "./types";

// ── fixtures ────────────────────────────────────────────────────────────────

const bandFor = (scenarioId: string, name: string): TradeoffBand => ({
  scenarioId,
  name,
  color: "#123456",
  chips: [],
  changeLines: [`${name}: retire earlier`],
  moreChangeCount: 0,
  narrative: "",
  gains: [{ label: "Plan confidence", amount: "+9 pts" }],
  costs: [{ label: "Net to heirs", amount: "−$220 K" }],
});

const COLUMNS: ColumnHeader[] = [
  { refKey: "base", name: "Base Case", descriptor: [], confidence: 0.8, color: "#111", badges: [] },
  { refKey: "s1", name: "Retire at 62", descriptor: [], confidence: 0.71, color: "#222", badges: [] },
  { refKey: "s2", name: "Work to 70", descriptor: [], confidence: 0.9, color: "#333", badges: [] },
];

const ROWS: MetricRow[] = [
  {
    label: "Plan confidence",
    indent: false,
    betterIs: "higher",
    cells: [
      { value: "80%", delta: null, direction: 0, isBest: false },
      { value: "71%", delta: "−9 pts", direction: -1, isBest: false },
      { value: "90%", delta: "+10 pts", direction: 1, isBest: true },
    ],
  },
  {
    label: "federal",
    indent: true,
    betterIs: "lower",
    cells: [
      { value: "$1.1M", delta: null, direction: 0, isBest: false },
      { value: "$0.9M", delta: "−$200 K", direction: 1, isBest: true },
      { value: "$1.3M", delta: "+$200 K", direction: -1, isBest: false },
    ],
  },
];

const BANDS = [bandFor("s1", "Retire at 62"), bandFor("s2", "Work to 70")];

function args(
  over: Partial<GenerateScenarioComparisonAiArgs> = {},
): GenerateScenarioComparisonAiArgs {
  return {
    clientId: "c1",
    householdName: "the Cooper household",
    firstNames: "Alan and Teresa",
    columns: COLUMNS,
    rows: ROWS,
    bands: BANDS,
    tone: "detailed",
    customInstructions: "",
    sentenceBudget: 4,
    stored: {},
    force: false,
    ...over,
  };
}

/** The hash the generator will compute for one band under `a`'s settings. */
function hashOf(band: TradeoffBand, a: GenerateScenarioComparisonAiArgs): string {
  return hashBand({
    scenarioId: band.scenarioId,
    name: band.name,
    gains: band.gains,
    costs: band.costs,
    changeLines: band.changeLines,
    tone: a.tone,
    customInstructions: a.customInstructions,
    sentenceBudget: a.sentenceBudget,
  });
}

/** Stored entries whose hash matches, so every listed band is FRESH. */
function freshStore(
  a: GenerateScenarioComparisonAiArgs,
  bands: TradeoffBand[],
): GenerateScenarioComparisonAiArgs["stored"] {
  return Object.fromEntries(
    bands.map((b) => [b.scenarioId, { generatedText: `stored ${b.scenarioId}`, sourceHash: hashOf(b, a) }]),
  );
}

const respondWith = (entries: Array<{ scenarioId: string; paragraph: string }>) =>
  invoke.mockResolvedValue({ narratives: entries });

beforeEach(() => {
  invoke.mockReset();
  // mockClear, not mockReset — these keep their factory implementations.
  chatModel.mockClear();
  withStructuredOutput.mockClear();
  getCachedAnalysis.mockReset();
  getCachedAnalysis.mockResolvedValue(null);
  setCachedAnalysis.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateScenarioComparisonAi", () => {
  it("makes no model call when every band's hash matches its stored text", async () => {
    const a = args();
    const result = await generateScenarioComparisonAi({ ...a, stored: freshStore(a, BANDS) });

    expect(invoke).not.toHaveBeenCalled();
    expect(getCachedAnalysis).not.toHaveBeenCalled();
    expect(result.byScenario).toEqual({});
    expect(result.cached).toBe(true);
  });

  it("makes ONE call when any band is stale", async () => {
    const a = args();
    respondWith([
      { scenarioId: "s1", paragraph: "one" },
      { scenarioId: "s2", paragraph: "two" },
    ]);

    await generateScenarioComparisonAi({ ...a, stored: freshStore(a, [BANDS[0]]) });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("prompts with EVERY band, not only the stale ones, so the model can contrast them", async () => {
    const a = args();
    respondWith([{ scenarioId: "s2", paragraph: "two" }]);

    await generateScenarioComparisonAi({ ...a, stored: freshStore(a, [BANDS[0]]) });

    const user = (invoke.mock.calls[0][0] as Array<{ content: string }>)[1].content;
    expect(user).toContain("scenarioId: s1");
    expect(user).toContain("scenarioId: s2");
  });

  it("returns only the stale bands", async () => {
    const a = args();
    respondWith([
      { scenarioId: "s1", paragraph: "one" },
      { scenarioId: "s2", paragraph: "two" },
    ]);

    const result = await generateScenarioComparisonAi({ ...a, stored: freshStore(a, [BANDS[0]]) });

    expect(Object.keys(result.byScenario)).toEqual(["s2"]);
    expect(result.byScenario.s2.markdown).toBe("two");
    expect(result.byScenario.s2.hash).toBe(hashOf(BANDS[1], a));
  });

  // A positional match silently prints one scenario's narrative under another
  // scenario's heading, and every value on the page still looks plausible.
  it("matches responses by scenarioId, not by array position", async () => {
    respondWith([
      { scenarioId: "s2", paragraph: "TEXT FOR S2" },
      { scenarioId: "s1", paragraph: "TEXT FOR S1" },
    ]);

    const result = await generateScenarioComparisonAi(args());

    expect(result.byScenario.s1.markdown).toBe("TEXT FOR S1");
    expect(result.byScenario.s2.markdown).toBe("TEXT FOR S2");
  });

  it("drops a response entry naming an unknown scenarioId", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    respondWith([
      { scenarioId: "s1", paragraph: "one" },
      { scenarioId: "ghost", paragraph: "nobody asked for this" },
    ]);

    const result = await generateScenarioComparisonAi(args());

    expect(warn).toHaveBeenCalled();
    expect(Object.keys(result.byScenario)).toEqual(["s1"]);
  });

  // Storing "" against a matching hash reads as stale on the very next export,
  // so an empty answer would buy the same call again on every run.
  it("leaves a band out when the model answers it with an empty paragraph", async () => {
    respondWith([
      { scenarioId: "s1", paragraph: "   " },
      { scenarioId: "s2", paragraph: "two" },
    ]);

    const result = await generateScenarioComparisonAi(args());

    expect(Object.keys(result.byScenario)).toEqual(["s2"]);
  });

  it("regenerates a band whose stored text is empty even when the hash matches", async () => {
    const a = args();
    respondWith([{ scenarioId: "s1", paragraph: "refilled" }]);
    const stored = freshStore(a, BANDS);
    stored.s1 = { ...stored.s1, generatedText: "" };

    const result = await generateScenarioComparisonAi({ ...a, stored });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.byScenario)).toEqual(["s1"]);
  });

  it("force marks every band stale, and skips the Redis read", async () => {
    const a = args();
    respondWith([
      { scenarioId: "s1", paragraph: "one" },
      { scenarioId: "s2", paragraph: "two" },
    ]);

    const result = await generateScenarioComparisonAi({
      ...a,
      stored: freshStore(a, BANDS),
      force: true,
    });

    expect(getCachedAnalysis).not.toHaveBeenCalled();
    expect(Object.keys(result.byScenario)).toEqual(["s1", "s2"]);
  });

  it("serves a Redis hit without calling the model", async () => {
    getCachedAnalysis.mockResolvedValue({
      markdown: JSON.stringify({ narratives: [{ scenarioId: "s1", paragraph: "from cache" }] }),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await generateScenarioComparisonAi(args());

    expect(invoke).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.byScenario.s1).toMatchObject({
      markdown: "from cache",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("treats an unreadable cache value as a miss rather than throwing", async () => {
    getCachedAnalysis.mockResolvedValue({ markdown: "not json", generatedAt: "t" });
    respondWith([{ scenarioId: "s1", paragraph: "regenerated" }]);

    const result = await generateScenarioComparisonAi(args());

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.byScenario.s1.markdown).toBe("regenerated");
  });

  it("rethrows a model failure instead of swallowing it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("azure down"));

    await expect(generateScenarioComparisonAi(args())).rejects.toThrow("azure down");
    expect(setCachedAnalysis).not.toHaveBeenCalled();
  });

  it("pins the full deployment and the named structured-output schema", async () => {
    respondWith([{ scenarioId: "s1", paragraph: "one" }]);

    await generateScenarioComparisonAi(args());

    expect(chatModel).toHaveBeenCalledWith("full");
    expect(withStructuredOutput.mock.calls[0][1]).toEqual({
      name: "scenario_comparison_narratives",
    });
  });
});

// ── the loader half ─────────────────────────────────────────────────────────

describe("prepareScenarioComparisonAiInputs", () => {
  // Only the fields buildScenarioComparisonData reads are populated, matching
  // the fixture shape in view-model.test.ts.
  const CLIENT = {
    firstName: "Alan", lastName: "Cooper", spouseName: "Teresa",
    dateOfBirth: "1988-04-01", retirementAge: 62,
  };
  const yr = (y: number, liquid: number) =>
    ({
      year: y,
      portfolioAssets: { liquidTotal: liquid, cashTotal: 0, retirementTotal: liquid, taxableTotal: 0 },
      expenses: { taxes: 40_000 },
      taxResult: {
        flow: { totalFederalTax: 30_000, stateTax: 10_000, capitalGainsTax: 0, fica: 0, totalTax: 40_000 },
        income: { grossTotalIncome: 160_000 },
      },
    }) as never;

  const bundle = (label: string, liquid: number, success: number) =>
    ({
      scenarioLabel: label,
      clientData: { client: { ...CLIENT } },
      projection: { years: [yr(2050, liquid), yr(2075, liquid * 2)] },
      monteCarlo: { summary: { successRate: success, ending: { p20: liquid / 2 } } },
    }) as never;

  const opts = (over: Partial<ScenarioComparisonOptions> = {}): ScenarioComparisonOptions => ({
    ...SCENARIO_COMPARISON_OPTIONS_DEFAULT,
    scenarioIds: ["s1", "s2"],
    ...over,
  });

  beforeEach(() => {
    loadPageScenarioBundles.mockReset();
    getOrComputeMaxSpending.mockClear();
    // Keyed by keyForRef, exactly as the shared loader returns them.
    loadPageScenarioBundles.mockResolvedValue({
      base: bundle("Base Case", 2_400_000, 0.73),
      "scenario:s1": bundle("Retire at 62", 2_100_000, 0.82),
      "scenario:s2": bundle("Work to 70", 2_900_000, 0.91),
    });
  });

  it("asks the shared loader for base plus each distinct scenario, MC on every column", async () => {
    await prepareScenarioComparisonAiInputs("c1", "f1", opts({ scenarioIds: ["s1", "s1", "s2"] }));

    const { requests } = loadPageScenarioBundles.mock.calls[0][0] as {
      requests: Array<{ ref: { id: string }; needsMonteCarlo: boolean; needsScenarioChanges: boolean }>;
    };
    expect(requests.map((r) => r.ref.id)).toEqual(["base", "s1", "s2"]);
    // The matrix prints plan confidence for every column, so every column needs one.
    expect(requests.every((r) => r.needsMonteCarlo)).toBe(true);
    // Only the live scenarios carry a change set — base never does.
    expect(requests.map((r) => r.needsScenarioChanges)).toEqual([false, true, true]);
  });

  // If the returned map were keyed any other way, buildScenarioComparisonData
  // would resolve no columns and fall through to its empty state, so a non-null
  // result carrying every column IS the keying assertion.
  it("reads the bundles back by keyForRef — base first, then each scenario in order", async () => {
    const inputs = await prepareScenarioComparisonAiInputs("c1", "f1", opts());

    expect(inputs).not.toBeNull();
    expect(inputs!.columns.map((c) => c.refKey)).toEqual(["base", "s1", "s2"]);
    expect(inputs!.columns.map((c) => c.name)).toEqual([
      "Base Case", "Retire at 62", "Work to 70",
    ]);
    expect(inputs!.bands.map((b) => b.scenarioId)).toEqual(["s1", "s2"]);
  });

  it("returns null when the loader yields nothing that can be compared", async () => {
    loadPageScenarioBundles.mockResolvedValue({ base: bundle("Base Case", 2_400_000, 0.73) });

    expect(await prepareScenarioComparisonAiInputs("c1", "f1", opts())).toBeNull();
  });

  // The renderer truncates to this same budget; a mismatch would cut text the
  // model was told it had room for.
  it("sizes sentenceBudget off the scenario-column count, as the view model does", async () => {
    const two = await prepareScenarioComparisonAiInputs("c1", "f1", opts());
    expect(two!.sentenceBudget).toBe(narrativeSentenceBudget(two!.columns.length - 1));
    expect(two!.sentenceBudget).toBe(narrativeSentenceBudget(2));

    loadPageScenarioBundles.mockResolvedValue({
      base: bundle("Base Case", 2_400_000, 0.73),
      "scenario:s1": bundle("Retire at 62", 2_100_000, 0.82),
    });
    const one = await prepareScenarioComparisonAiInputs("c1", "f1", opts({ scenarioIds: ["s1"] }));
    expect(one!.sentenceBudget).toBe(narrativeSentenceBudget(one!.columns.length - 1));
    expect(one!.sentenceBudget).toBe(narrativeSentenceBudget(1));
  });

  it("names the household from the base column's client", async () => {
    const inputs = await prepareScenarioComparisonAiInputs("c1", "f1", opts());

    expect(inputs!.householdName).toBe("the Cooper household");
    expect(inputs!.firstNames).toBe("Alan and Teresa");
  });

  it("solves max-spend for every column when the row is shown, and skips it when it is not", async () => {
    await prepareScenarioComparisonAiInputs("c1", "f1", opts());
    expect(getOrComputeMaxSpending.mock.calls.map((c) => c[0].scenarioId))
      .toEqual(expect.arrayContaining(["base", "s1", "s2"]));

    getOrComputeMaxSpending.mockClear();
    await prepareScenarioComparisonAiInputs("c1", "f1", opts({
      maxSpend: { show: false, targetConfidence: 0.85 },
    }));
    expect(getOrComputeMaxSpending).not.toHaveBeenCalled();
  });

  it("degrades a failed max-spend solve to a dash instead of failing the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getOrComputeMaxSpending.mockRejectedValue(new Error("solver down"));

    const inputs = await prepareScenarioComparisonAiInputs("c1", "f1", opts());

    const row = inputs!.rows.find((r) => r.label === "Max sustainable spending");
    expect(row?.cells.every((c) => c.value === "—")).toBe(true);
  });
});
