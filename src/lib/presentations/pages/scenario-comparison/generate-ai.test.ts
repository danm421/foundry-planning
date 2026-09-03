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

const HEIR_TAX: Record<string, number | null> = {
  base: 412_000, s1: 180_000, s2: 505_000,
};

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
    heirIncomeTaxByRef: HEIR_TAX,
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
    heirIncomeTax: a.heirIncomeTaxByRef[band.scenarioId] ?? null,
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

  it("hands the model each column's inherited-asset tax, named and in dollars", async () => {
    const a = args();
    respondWith([{ scenarioId: "s1", paragraph: "one" }, { scenarioId: "s2", paragraph: "two" }]);

    await generateScenarioComparisonAi(a);

    const [system, user] = (invoke.mock.calls[0][0] as Array<{ content: string }>)
      .map((m) => m.content);
    expect(user).toContain("Base Case: $412k");
    expect(user).toContain("Retire at 62: $180k");
    expect(user).toContain("Work to 70: $505k");
    // …and the instruction that tells it what that block MEANS. Without this
    // the figures are just three more numbers to restate.
    expect(system).toContain("ALREADY NET of it");
  });

  it("drops the inherited-asset block entirely when the household has no estate report", async () => {
    const a = args({
      heirIncomeTaxByRef: Object.fromEntries(COLUMNS.map((c) => [c.refKey, null])),
    });
    respondWith([{ scenarioId: "s1", paragraph: "one" }, { scenarioId: "s2", paragraph: "two" }]);

    await generateScenarioComparisonAi(a);

    const [system, user] = (invoke.mock.calls[0][0] as Array<{ content: string }>)
      .map((m) => m.content);
    // A block of "unavailable" would invite the model to explain the absence,
    // and the instruction would license a claim nothing backs.
    expect(user).not.toContain("heirs owe on the pre-tax retirement balances");
    expect(system).not.toContain("ALREADY NET of it");
  });

  it("restales a band when only its inherited-asset tax moves", async () => {
    const a = args();
    const fresh = freshStore(a, BANDS);
    respondWith([{ scenarioId: "s1", paragraph: "one" }]);

    const moved = args({ heirIncomeTaxByRef: { ...HEIR_TAX, s1: 90_000 } });
    const result = await generateScenarioComparisonAi({ ...moved, stored: fresh });

    expect(Object.keys(result.byScenario)).toEqual(["s1"]);
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

  /** Gives a bundle a first-death event and the matching year's transfers, so
   *  the estate report composes non-empty. `ird` is the income tax the heirs
   *  owe on the pre-tax balances they inherit — the report reads it off the
   *  estate's `ird_tax` drain attributions, which is the ONLY place it comes
   *  from, so a household with no IRD rate set really does report $0. */
  const withEstate = (base: unknown, toHeirs: number, ird: number) => {
    const b = base as { clientData: { client: Record<string, unknown> }; projection: { years: Array<{ year: number }> } };
    const deathYear = 2075;
    return {
      ...(base as object),
      clientData: {
        client: b.clientData.client,
        accounts: [], entities: [], externalBeneficiaries: [], wills: [],
        familyMembers: [{ id: "fm-child", role: "child", relationship: "child",
          firstName: "Alex", lastName: null, dateOfBirth: "2010-01-01" }],
      },
      projection: {
        years: b.projection.years.map((y) => y.year === deathYear ? { ...y, deathTransfers: [{
          year: deathYear, deathOrder: 1, deceased: "client",
          sourceAccountId: "acc-1", sourceAccountName: "IRA",
          sourceLiabilityId: null, sourceLiabilityName: null,
          via: "will", recipientKind: "family_member", recipientId: "fm-child",
          recipientLabel: "Alex", amount: toHeirs, basis: 0,
          resultingAccountId: null, resultingLiabilityId: null,
        }] } : y),
        firstDeathEvent: {
          year: deathYear, deathOrder: 1, deceased: "client",
          grossEstate: toHeirs, grossEstateLines: [], estateAdminExpenses: 0,
          maritalDeduction: 0, charitableDeduction: 0, taxableEstate: toHeirs,
          federalEstateTax: 0, stateEstateTax: 0, probateCost: 0,
          drainAttributions: ird > 0
            ? [{ drainKind: "ird_tax", amount: ird, accountId: "acc-1" }]
            : [],
          estateTaxDebits: [], creditorPayoffDebits: [],
        },
        secondDeathEvent: null,
      },
    } as never;
  };

  it("keys each column's inherited-asset income tax by that column's own refKey", async () => {
    loadPageScenarioBundles.mockResolvedValue({
      base: withEstate(bundle("Base Case", 2_400_000, 0.73), 1_000_000, 410_000),
      "scenario:s1": withEstate(bundle("Retire at 62", 2_100_000, 0.82), 1_400_000, 95_000),
      "scenario:s2": withEstate(bundle("Work to 70", 2_600_000, 0.9), 1_200_000, 220_000),
    });

    const inputs = await prepareScenarioComparisonAiInputs("c1", "f1", opts());

    // Distinct values per column: a positional or copy-paste slip would tell
    // one scenario's client another scenario's tax bill.
    expect(inputs!.heirIncomeTaxByRef).toEqual({ base: 410_000, s1: 95_000, s2: 220_000 });
  });

  it("reports $0 when the estate exists but no IRD tax is modelled", async () => {
    loadPageScenarioBundles.mockResolvedValue({
      base: withEstate(bundle("Base Case", 2_400_000, 0.73), 1_000_000, 0),
      "scenario:s1": withEstate(bundle("Retire at 62", 2_100_000, 0.82), 1_400_000, 0),
      "scenario:s2": withEstate(bundle("Work to 70", 2_600_000, 0.9), 1_200_000, 0),
    });

    const inputs = await prepareScenarioComparisonAiInputs("c1", "f1", opts());

    // $0 and null license different sentences — the prompt bars the "already
    // accounted for" claim on $0, and drops the block entirely on all-null.
    expect(inputs!.heirIncomeTaxByRef).toEqual({ base: 0, s1: 0, s2: 0 });
  });

  it("reports null for every column when there is no estate report to read", async () => {
    const inputs = await prepareScenarioComparisonAiInputs("c1", "f1", opts());

    expect(inputs!.heirIncomeTaxByRef).toEqual({ base: null, s1: null, s2: null });
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
