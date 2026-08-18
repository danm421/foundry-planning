// The loader's own IO is exercised by the route tests; what matters here is
// that it assembles a context the PURE layers accept — and that a missing Monte
// Carlo degrades to "no confidence fact" rather than a zero.
//
// Only the IO edges are mocked (tree load, projection, Monte Carlo cache, the
// scenario-changes queries, the balance-sheet builders). `buildStoryFacts`,
// `groupStrategies`, `describeChange`, `buildTargetNames` and
// `buildBaseResolveData` all run for real, so an assertion about a fact id or a
// row's text is an assertion about what the loader actually handed them —
// not about a mock echoed back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fx = vi.hoisted(() => ({
  client: {} as Record<string, unknown>,
  accounts: [] as Array<Record<string, unknown>>,
  /** The one `planSettings` field the loader reads. Per-ref, so a test can
   *  prove the BASE plan's rate is the one that reaches the pack even when a
   *  scenario overrides it. */
  inflationRate: {} as Record<string, number>,
  /** scenarioId → the projection years that ref should produce. */
  years: {} as Record<string, Array<Record<string, unknown>>>,
  /** scenarioId → success rate. A missing entry makes the cache throw. */
  mc: {} as Record<string, number>,
  changes: [] as Array<Record<string, unknown>>,
  toggleGroups: [] as Array<Record<string, unknown>>,
  /** Every argument object `getOrComputeMonteCarlo` was called with. */
  mcCalls: [] as Array<Record<string, unknown>>,
  changeQueries: [] as string[],
  /** scenarioId → solved annual spend. A missing entry makes the solve throw. */
  maxSpend: {} as Record<string, number>,
  /** Every ref the max-spend solve was ASKED for, in order — the observation
   *  point for the chapter gate, since a skipped solve leaves no fact either
   *  way when the fixture holds no figure for it. */
  maxSpendCalls: [] as string[],
  /** scenarioId → the estate report that ref should produce. A missing entry
   *  comes back EMPTY, which is a household with nothing on file. */
  estate: {} as Record<string, unknown>,
  /** Every argument object `buildEstateTransferReportData` was called with. */
  estateCalls: [] as Array<{ asOf: { kind: string }; ordering: string }>,
}));

vi.mock("@/lib/scenario/loader", () => ({
  // The fake tree carries the ref's id so the projection mock can hand back a
  // different set of years per scenario.
  loadEffectiveTreeForRef: vi.fn(
    async (_clientId: string, _firmId: string, ref: { id: string }) => ({
      effectiveTree: {
        client: fx.client,
        accounts: fx.accounts,
        scenarioId: ref.id,
        planSettings: { inflationRate: fx.inflationRate[ref.id] ?? 0.025 },
      },
    }),
  ),
}));

vi.mock("@/engine/projection", () => ({
  runProjectionWithEvents: vi.fn((tree: { scenarioId: string }) => ({
    years: fx.years[tree.scenarioId] ?? [],
  })),
}));

vi.mock("@/lib/compute-cache/monte-carlo", () => ({
  getOrComputeMonteCarlo: vi.fn(async (args: { scenarioId: string }) => {
    fx.mcCalls.push(args);
    const successRate = fx.mc[args.scenarioId];
    if (successRate == null) throw new Error("mc unavailable");
    return { payload: { summary: { successRate } } };
  }),
}));

// The solver has its own suites; here it only has to hand back a stable figure
// per ref — and to be able to FAIL, which is the branch that matters.
vi.mock("@/lib/compute-cache/max-spending", () => ({
  getOrComputeMaxSpending: vi.fn(async (args: { scenarioId: string }) => {
    fx.maxSpendCalls.push(args.scenarioId);
    const spend = fx.maxSpend[args.scenarioId];
    if (spend == null) throw new Error("max spend unavailable");
    return { realAnnualSpend: spend, scaleFactor: 1, achievedPoS: 0.85, status: "converged" };
  }),
}));

vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges: vi.fn(async (scenarioId: string) => {
    fx.changeQueries.push(scenarioId);
    return fx.changes;
  }),
  loadScenarioToggleGroups: vi.fn(async () => fx.toggleGroups),
}));

// The balance-sheet builders are covered by their own suites; here they only
// have to hand back stable household totals.
vi.mock("@/lib/balance-sheet/merge-synthetic-accounts", () => ({
  mergeSyntheticAccounts: vi.fn((tree: unknown) => tree),
}));
vi.mock("@/lib/balance-sheet/build-view-model-inputs", () => ({
  buildViewModelInputs: vi.fn(() => ({
    accounts: [], liabilities: [], entities: [], familyMembers: [], notesReceivable: [],
  })),
}));
vi.mock("@/components/balance-sheet-report/view-model", () => ({
  buildViewModel: vi.fn(() => ({
    totalAssets: 2_400_000,
    totalLiabilities: 300_000,
    netWorth: 2_100_000,
    // Deliberately raw: the liquid buckets ($1.4M — cash + taxable +
    // retirement + annuity) alongside two the plan cannot draw on. The loader
    // has to apply the Balance Sheet page's own filter, not sum the column.
    // The six sum to totalAssets, so a mis-filter shows up as $2.4M.
    assetCategories: [
      { key: "cash", total: 100_000 },
      { key: "taxable", total: 400_000 },
      { key: "retirement", total: 700_000 },
      { key: "annuity", total: 200_000 },
      { key: "realEstate", total: 850_000 },
      { key: "business", total: 150_000 },
    ],
  })),
}));

// The estate report has its own suites, and the fake tree here carries none of
// what it reads. `summarizeHousehold` is deliberately NOT mocked with it: the
// totalling is the half this loader depends on, and it is what proves debts stay
// out of "tax and costs".
vi.mock("@/lib/estate/transfer-report", () => ({
  buildEstateTransferReportData: vi.fn(
    (args: { asOf: { kind: string }; ordering: string; clientData: { scenarioId: string } }) => {
      fx.estateCalls.push({ asOf: args.asOf, ordering: args.ordering });
      return (
        fx.estate[args.clientData.scenarioId] ?? {
          isEmpty: true,
          firstDeath: null,
          secondDeath: null,
          aggregateRecipientTotals: [],
        }
      );
    },
  ),
}));

// The life-cover solve's inventory. Same call as the estate report above — the
// fake tree here carries no policies — but this one is a real DB read rather
// than a pure builder, so without the mock `lifeCover`'s own try/catch logs a
// failed query on EVERY test in this file, including the ones asserting that
// nothing was logged.
//
// An empty inventory is also the loader's deliberate short-circuit: no policies,
// no solve, because that solve is by far the most expensive thing this loader
// can run and it is on the PDF export path. So the cover facts are absent here
// by construction, and the chapter's own suite owns what the narrator does with
// them.
//
// Held on a handle because this read is also the OBSERVATION POINT for the
// chapter gate below: it is the first thing `lifeCover` does, so "was it
// called" is exactly "did the loader start the solve".
const li = vi.hoisted(() => ({
  loadLifeInsuranceInventory: vi.fn(async () => ({ policies: [] })),
}));
vi.mock("@/lib/insurance-policies/load-li-inventory", () => li);

// The advisor's next steps. Mocked at the module rather than at `@/db` because
// the query and its mapping have their own suite (`load-next-steps.test.ts`);
// what this file is for is WHEN the loader calls it and where the answer lands.
const steps = vi.hoisted(() => ({
  loadStoryNextSteps: vi.fn(async () => [{ text: "Send us last year's return", owner: "Client", when: "" }]),
}));
vi.mock("../load-next-steps", () => steps);

// Same call as the balance-sheet builders above: the Goals board has its own
// suite, and the fake tree here carries no `planSettings` for it to read. What
// this file is for is what the LOADER does with the result — which cards become
// goals, and which are dropped as horizon rather than intent.
vi.mock("@/lib/household-map/build-boards", () => ({
  buildMapBoards: vi.fn(() => ({
    people: {},
    items: [],
    netWorth: 0,
    goals: [
      { year: 2032, kind: "education", title: "Maggie · State University" },
      { year: 2036, kind: "purchase", title: "A place at the lake" },
      { year: 2041, kind: "retirement", title: "Alan retires" },
      { year: 2069, kind: "life_expectancy", title: "Teresa turns 90" },
      { year: 2046, kind: "social_security", title: "Alan claims Social Security" },
    ],
  })),
}));

import { loadStoryContext } from "../load-context";
import { goalYearFactId } from "../build-facts";
import type { ChapterId } from "../types";

const CLIENT = {
  firstName: "Alan",
  lastName: "Bradshaw",
  spouseName: "Teresa",
  dateOfBirth: "1979-04-02",
  retirementAge: 62,
  lifeExpectancy: 90,
};

/**
 * `salaries` covers the year's Total Expenses unless a test lowers it — which is
 * what makes a shortfall year something a test has to ASK for rather than
 * something the fixture produces by accident.
 */
const year = (y: number, taxable: number, cash: number, retirement: number, salaries = 320_000) => ({
  year: y,
  portfolioAssets: { taxableTotal: taxable, cashTotal: cash, retirementTotal: retirement },
  // This year's flow, as the engine writes it. `totalExpenses` is deliberately
  // MORE than `expenses.total` here: the difference is what the household puts
  // away, and the loader takes it as a difference rather than reading
  // `savings.total`, so a self-funding savings rule cannot go missing.
  totalIncome: 320_000,
  expenses: { total: 210_000 },
  totalExpenses: 270_000,
  // What `retirementInflows` reads to decide whether the year funds itself.
  income: { socialSecurity: 0, salaries, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0 },
  accountLedgers: {},
  withdrawals: { total: 0 },
});

/**
 * A year the tax engine actually produced a result for. The default `year`
 * above carries NO `taxResult`, which is what a plan run with the tax engine
 * off looks like — and what makes the "0 is not an answer" rule testable.
 */
const taxedYear = (y: number, totalTax: number) => ({
  ...year(y, 0, 0, 0),
  taxResult: {
    flow: { totalFederalTax: totalTax, stateTax: 0, capitalGainsTax: 0, totalTax },
    income: { grossTotalIncome: totalTax * 4 },
  },
});

/**
 * Just enough of an estate report for the REAL `summarizeHousehold` to total.
 * The debts line is deliberately present and deliberately large: it is money
 * owed, not a cost of dying, and it must not reach `estate.cost.*`.
 */
const estateReport = (netToHeirs: number, federal: number, probate: number) => ({
  isEmpty: false,
  firstDeath: {
    reductions: [
      { kind: "federal_estate_tax", amount: federal },
      { kind: "probate", amount: probate },
      { kind: "debts_paid", amount: 250_000 },
    ],
  },
  secondDeath: null,
  aggregateRecipientTotals: [{ total: netToHeirs }],
});

/** 2026 → $1.2M liquid, 2065 → $2.0M liquid. */
const BASE_YEARS = [year(2026, 400_000, 100_000, 700_000), year(2065, 900_000, 100_000, 1_000_000)];
/** Same start, $2.6M left at the end — distinct from every base figure. */
const PROPOSED_YEARS = [year(2026, 400_000, 100_000, 700_000), year(2065, 1_200_000, 100_000, 1_300_000)];

const display = (ctx: { facts: Array<{ id: string; display: string }> }, id: string) =>
  ctx.facts.find((f) => f.id === id)?.display ?? null;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fx.client = { ...CLIENT };
  fx.accounts = [];
  fx.years = { base: BASE_YEARS };
  fx.mc = {};
  fx.changes = [];
  fx.toggleGroups = [];
  fx.mcCalls = [];
  fx.changeQueries = [];
  fx.maxSpend = {};
  fx.maxSpendCalls = [];
  fx.estate = {};
  fx.estateCalls = [];
  fx.inflationRate = {};
  li.loadLifeInsuranceInventory.mockClear();
  steps.loadStoryNextSteps.mockClear();
  // The Monte-Carlo-failure path logs; keep the suite's output clean while
  // still asserting the failure was recorded rather than silently swallowed.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("loadStoryContext", () => {
  it("omits the confidence facts when Monte Carlo fails, and never throws", async () => {
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });

    // Absent, never zeroed — a 0% confidence figure in a client document is a lie.
    expect(ctx.facts.some((f) => f.id === "outcome.confidence.base")).toBe(false);
    expect(ctx.facts.some((f) => f.id === "outcome.confidence.proposed")).toBe(false);
    expect(errorSpy).toHaveBeenCalled();

    expect(ctx.hasProposal).toBe(false);
    expect(ctx.strategies).toEqual([]);
    expect(ctx.household.firstNames).toBe("Alan and Teresa");
    expect(ctx.household.householdName).toBe("the Bradshaw household");
    expect(ctx.scenarioLabel).toBe("Base Case");
    expect(ctx.documentRole).toBe("standalone");
  });

  it("maps the balance sheet, the projection ends and the retirement year into the pack", async () => {
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });

    expect(display(ctx, "today.assets")).toBe("$2.4M");
    expect(display(ctx, "today.debts")).toBe("$300K");
    expect(display(ctx, "today.netWorth")).toBe("$2.1M");
    // Off the same balance sheet as the two figures above, filtered to the
    // buckets the plan can draw on: $1.4M, not the whole $2.4M column and not
    // the projection year's end-of-year, taxable+cash+retirement-only $1.2M.
    expect(display(ctx, "today.liquid")).toBe("$1.4M");
    // Last projection year's liquid, on the engine's Monte-Carlo definition.
    expect(display(ctx, "outcome.legacy.base")).toBe("$2.0M");
    // Birth year + retirementAge — not life expectancy, not the plan end.
    expect(display(ctx, "plan.retirementYear")).toBe("2041");
    expect(display(ctx, "plan.endOfLifeYear")).toBe("2065");
    // Base-only: there is no proposed plan to leave anything behind.
    expect(ctx.facts.some((f) => f.id === "outcome.legacy.proposed")).toBe(false);
  });

  it("puts the chart arrays and the chart facts on the context from ONE build", async () => {
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });

    const peak = ctx.facts.find((f) => f.id === "chart.portfolio.peak");
    expect(ctx.charts?.portfolio.length).toBeGreaterThan(0);
    // The fact's raw value must be the max of the array the renderer will
    // draw — that identity is the whole point of building the bars once.
    expect(peak?.raw).toBe(Math.max(...ctx.charts!.portfolio.map((b) => b.total)));
  });

  it("takes this year's flow off the first projection year, tying out to Cash Flow", async () => {
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });

    expect(display(ctx, "flow.income")).toBe("$320K");
    // `expenses.total`, not `totalExpenses` — the Cash Flow page's Expenses row.
    expect(display(ctx, "flow.spending")).toBe("$210K");
    // Total Expenses MINUS Expenses. Reading `savings.total` instead would drop
    // a self-funding rule's contribution and overstate the household's headroom.
    expect(display(ctx, "flow.saving")).toBe("$60K");
    // No fourth total: three rounded figures that do not visibly subtract to it
    // are worse on a client page than none.
    expect(ctx.facts.some((f) => f.id.startsWith("flow.") && !["flow.income", "flow.spending", "flow.saving"].includes(f.id))).toBe(false);
  });

  it("names no shortfall year for a plan that funds itself", async () => {
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });
    expect(ctx.facts.some((f) => f.id === "base.shortfallYear")).toBe(false);
  });

  it("names the FIRST year the current plan cannot cover its own spending", async () => {
    // The app's existing definition, off `retirementInflows` — the same one the
    // Retirement Analysis hero chart and year table draw. A second definition
    // here would put a different year on the client's page than the one the
    // advisor is looking at on screen.
    fx.years = {
      base: [year(2026, 400_000, 100_000, 700_000), year(2050, 100_000, 0, 0, 10_000), year(2065, 0, 0, 0, 5_000)],
    };
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });
    expect(display(ctx, "base.shortfallYear")).toBe("2050");
  });

  it("carries the household's goals and drops the life milestones", async () => {
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });

    // Retirement, life expectancy and the Social Security claim are the
    // HORIZON, not things the household wants the money to do — and the first
    // of them is already `plan.retirementYear` in the pack above. Chapter 1
    // would otherwise open by telling the reader their retirement is a goal.
    expect(ctx.goals).toEqual([
      { name: "Maggie · State University", year: 2032, kind: "Education" },
      { name: "A place at the lake", year: 2036, kind: "Purchase" },
    ]);
  });

  it("puts each goal's date in the pack, keyed to its position", async () => {
    // A four-digit year is a figure to Gate 1, so chapter 1 can only print a
    // goal's date if the pack holds it. The narrator looks it up by INDEX, so
    // the pack and `ctx.goals` have to be built from one array — this is that
    // pairing, asserted from the outside.
    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });

    for (const [index, goal] of ctx.goals.entries()) {
      expect(display(ctx, goalYearFactId(index))).toBe(String(goal.year));
    }
  });

  it("names a household with no spouse without a dangling 'and'", async () => {
    fx.client = { ...CLIENT, spouseName: undefined };

    const ctx = await loadStoryContext({
      clientId: "c1",
      firmId: "f1",
      proposedRef: null,
      scenarioLabel: "Base Case",
      documentRole: "standalone",
    });

    expect(ctx.household.firstNames).toBe("Alan");
  });

  /**
   * The `chapters` gate. It buys SPEND and nothing else — the sheet is still
   * reserved by `printedChapters` and the chapter still prints — so the only
   * thing to prove is which expensive call runs.
   *
   * Two calls read it, and they are the loader's only real solves. `lifeCover`
   * is a per-year deterministic need curve plus a Monte Carlo search per life,
   * observable through the inventory read it starts with. `maxSpendFor` is a
   * bisection over 250-trial simulations, observable through the cache call
   * `fx.maxSpend` drives.
   */
  describe("the chapter gate on the solves", () => {
    const load = (chapters: readonly ChapterId[]) =>
      loadStoryContext({
        clientId: "c1",
        firmId: "f1",
        proposedRef: null,
        scenarioLabel: "Base Case",
        documentRole: "standalone",
        chapters,
      });

    /**
     * ⭐ The common case, not an edge one: `whatYouCanSpend` requires a
     * proposal, so `printedChapters` can never return it for a base-only story
     * — the default deck included — and every one of those was paying for the
     * bisection to produce a figure it could not print.
     */
    it("skips both max-spend solves for a report that cannot print the figure", async () => {
      fx.maxSpend = { base: 180_000 };

      const ctx = await load(["planInOnePage", "protectingYourFamily"]);

      expect(fx.maxSpendCalls).toEqual([]);
      expect(ctx.facts.some((f) => f.id.startsWith("spend."))).toBe(false);
    });

    it("runs it when the spending chapter is on the list", async () => {
      fx.maxSpend = { base: 180_000 };

      const ctx = await load(["planInOnePage", "whatYouCanSpend"]);

      expect(fx.maxSpendCalls).toEqual(["base"]);
      expect(display(ctx, "spend.base")).toBe("$180K");
    });

    it("skips the solve for a report that does not print the cover chapter", async () => {
      await load(["planInOnePage", "whatYouHave"]);

      expect(li.loadLifeInsuranceInventory).not.toHaveBeenCalled();
    });

    it("runs it when the cover chapter is on the list", async () => {
      await load(["planInOnePage", "protectingYourFamily"]);

      expect(li.loadLifeInsuranceInventory).toHaveBeenCalled();
    });

    /**
     * ⚠️⚠️ ABSENT MEANS ALL, and this is the test that keeps it that way. The
     * safe default is loading too much: a caller that named no chapters and
     * silently lost its cover facts would print the chapter's empty state
     * instead — a wrong page no gate, no page count and no type can see.
     *
     * Written without the helper above, with the key genuinely absent, because
     * that is the caller this is about.
     */
    it("runs it for a caller that names no chapters at all", async () => {
      await loadStoryContext({
        clientId: "c1",
        firmId: "f1",
        proposedRef: null,
        scenarioLabel: "Base Case",
        documentRole: "standalone",
      });

      expect(li.loadLifeInsuranceInventory).toHaveBeenCalled();
    });

    // …and an EMPTY list is a real list, not a missing one. `?? true` on
    // `args.chapters?.includes(...)` gets this right; `args.chapters?.length ?
    // … : true` does not.
    it("treats a report that prints nothing as printing nothing", async () => {
      await load([]);

      expect(li.loadLifeInsuranceInventory).not.toHaveBeenCalled();
    });
  });

  /**
   * The one chapter whose content the advisor writes. Not facts and not prose:
   * the steps reach the client unaltered, so all this loader owes them is the
   * read, the base plan to resolve their tokens against, and a place on the
   * context for the checklist layout to find them.
   */
  describe("the advisor's next steps", () => {
    const load = (chapters?: readonly ChapterId[]) =>
      loadStoryContext({
        clientId: "c1",
        firmId: "f1",
        proposedRef: null,
        scenarioLabel: "Base Case",
        documentRole: "standalone",
        chapters,
      });

    it("carries them onto the context", async () => {
      const ctx = await load();
      expect(ctx.nextSteps).toEqual([{ text: "Send us last year's return", owner: "Client", when: "" }]);
    });

    /**
     * The BASE plan, and this client. A step's merge tokens are facts about the
     * household — "the year you stop working" — so resolving them against
     * whichever proposal happened to be in the deck would make one action item
     * read differently on every export.
     */
    it("resolves their tokens against the base plan", async () => {
      fx.years = { base: BASE_YEARS, "sc-1": PROPOSED_YEARS };
      fx.mc = { base: 0.72 };

      await loadStoryContext({
        clientId: "c1",
        firmId: "f1",
        proposedRef: "sc-1",
        scenarioLabel: "Retire at 62",
        documentRole: "standalone",
      });

      expect(steps.loadStoryNextSteps).toHaveBeenCalledWith("c1", {
        clientData: expect.objectContaining({ scenarioId: "base" }),
        projection: { years: BASE_YEARS },
        monteCarlo: { successRate: 0.72 },
      });
    });

    /** Absent, never 0%. The confidence tokens resolve to nothing when Monte
     *  Carlo did not run, exactly as the confidence FACTS are withheld. */
    it("hands the tokens no confidence rather than a zero when Monte Carlo fails", async () => {
      await load();
      expect(steps.loadStoryNextSteps).toHaveBeenCalledWith("c1", expect.objectContaining({ monteCarlo: null }));
    });

    it("skips the read for a report that does not print the chapter", async () => {
      const ctx = await load(["planInOnePage", "whatYouHave"]);

      expect(steps.loadStoryNextSteps).not.toHaveBeenCalled();
      expect(ctx.nextSteps).toEqual([]);
    });

    it("runs it when the chapter is on the list", async () => {
      await load(["planInOnePage", "whatHappensNext"]);
      expect(steps.loadStoryNextSteps).toHaveBeenCalled();
    });

    /**
     * ⚠️⚠️ Absent means all, the same rule the solves follow — and the stakes
     * are higher here. A skipped solve leaves a figure out; skipped steps print
     * "nothing's been written down yet" over a list the advisor did write.
     */
    it("runs it for a caller that names no chapters at all", async () => {
      await load();
      expect(steps.loadStoryNextSteps).toHaveBeenCalled();
    });
  });

  describe("with a proposed scenario", () => {
    beforeEach(() => {
      fx.years = { base: BASE_YEARS, "sc-1": PROPOSED_YEARS };
      fx.mc = { base: 0.72, "sc-1": 0.91 };
      fx.accounts = [{ id: "acct-1", name: "Joint Brokerage", category: "taxable" }];
      fx.toggleGroups = [
        { id: "grp-1", scenarioId: "sc-1", name: "Save more, spend less", defaultOn: true, requiresGroupId: null, orderIndex: 0 },
      ];
      fx.changes = [
        {
          id: "ch-1", scenarioId: "sc-1", opType: "add", targetKind: "savings_rule", targetId: "sr-1",
          payload: { accountId: "acct-1", annualAmount: 30_000 }, toggleGroupId: "grp-1", orderIndex: 0,
        },
        {
          id: "ch-2", scenarioId: "sc-1", opType: "edit", targetKind: "expense", targetId: "exp-1",
          payload: { amount: { from: 60_000, to: 48_000 } }, toggleGroupId: "grp-1", orderIndex: 1,
        },
        {
          id: "ch-3", scenarioId: "sc-1", opType: "edit", targetKind: "client", targetId: "c1",
          payload: { retirementAge: { from: 65, to: 62 } }, toggleGroupId: null, orderIndex: 2,
        },
      ];
    });

    const load = () =>
      loadStoryContext({
        clientId: "c1",
        firmId: "f1",
        proposedRef: "sc-1",
        scenarioLabel: "Retire at 62",
        documentRole: "frontMatter",
      });

    /**
     * A scenario can override the inflation rate, and the chapter that states
     * the assumptions is not a comparison — it has one column. Taking the
     * proposal's rate would tell the client what we assume about prices under a
     * plan they have not agreed to, while every figure around it still states
     * both plans.
     */
    it("states the BASE plan's inflation rate, not the proposal's", async () => {
      fx.inflationRate = { base: 0.025, "sc-1": 0.04 };
      const ctx = await load();
      const rate = ctx.facts.find((f) => f.id === "plan.inflationRate");
      expect(rate?.display).toBe("2.5%");
    });

    it("groups the scenario's changes into named strategies", async () => {
      const ctx = await load();

      expect(ctx.hasProposal).toBe(true);
      expect(ctx.documentRole).toBe("frontMatter");
      // Toggle-group members collapse under the group's own name; the loose
      // change keeps the row's name. Order follows the changes table.
      expect(ctx.strategies.map((s) => s.name)).toEqual(["Save more, spend less", "Retirement age"]);
      expect(ctx.strategies[0].rows).toHaveLength(2);
      expect(ctx.strategies[1].rows).toHaveLength(1);
      expect(fx.changeQueries).toEqual(["sc-1"]);
    });

    it("resolves account names in the change text rather than 'an account'", async () => {
      const ctx = await load();

      expect(ctx.strategies[0].rows[0].detail[0]).toBe("Joint Brokerage · $30k/yr");
    });

    it("puts the strategies' own figures in the fact pack", async () => {
      const ctx = await load();

      // The recommendation chapter may only print a change's text when every
      // figure in it is grounded. These entries exist only if the loader handed
      // the SAME strategies to buildStoryFacts that it put on the context —
      // passing [] would compile and silently gut the chapter.
      expect(display(ctx, "quoted.$30k")).toBe("$30k");
      expect(display(ctx, "quoted.$60k")).toBe("$60k");
      expect(display(ctx, "quoted.$48k")).toBe("$48k");
      expect(ctx.facts.find((f) => f.id === "quoted.$30k")?.label).toContain("Save more, spend less");
    });

    it("solves each plan's max spend under its own ref, and never zeroes a failure", async () => {
      fx.maxSpend = { base: 150_000, "sc-1": 185_000 };
      const ctx = await load();
      expect(display(ctx, "spend.base")).toBe("$150K");
      expect(display(ctx, "spend.proposed")).toBe("$185K");

      // …and when a solve does not come back the fact is ABSENT, not $0. This
      // is the figure a client is most likely to act on.
      fx.maxSpend = { base: 150_000 };
      const partial = await load();
      expect(display(partial, "spend.base")).toBe("$150K");
      expect(partial.facts.some((f) => f.id === "spend.proposed")).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it("takes both plans' estate figures off the Estate Summary page's own report", async () => {
      fx.estate = {
        base: estateReport(3_100_000, 500_000, 200_000),
        "sc-1": estateReport(3_900_000, 300_000, 100_000),
      };
      const ctx = await load();

      expect(display(ctx, "estate.net.base")).toBe("$3.1M");
      expect(display(ctx, "estate.net.proposed")).toBe("$3.9M");
      // Estate tax plus probate. The $250K of debts paid is money OWED, not a
      // cost of dying, and `summarizeHousehold` keeps it out of `taxAndCosts` —
      // a chapter that included it would overstate what dying costs by a third.
      expect(display(ctx, "estate.cost.base")).toBe("$700K");
      expect(display(ctx, "estate.cost.proposed")).toBe("$400K");
      // End of Life, which is the column that page's KPI strip reads and the
      // horizon `outcome.legacy.*` is already stated at.
      expect(fx.estateCalls).toHaveLength(2);
      expect(fx.estateCalls.every((c) => c.asOf.kind === "split")).toBe(true);
      expect(fx.estateCalls.every((c) => c.ordering === "primaryFirst")).toBe(true);
    });

    it("draws the estate chart as current plan against proposed plan, at end of life", async () => {
      fx.estate = {
        base: estateReport(3_100_000, 500_000, 200_000),
        "sc-1": estateReport(3_900_000, 300_000, 100_000),
      };
      const ctx = await load();

      expect(ctx.charts?.estate?.map((b) => b.label)).toEqual(["Current plan", "Proposed plan"]);
      // Current plan first, because the prose leads on it and moves FROM it
      // (`chapters/whats-left-for-people.ts`). A reversed pair would put the
      // paragraph's "from" on the right of the picture's "to".
      expect(ctx.charts!.estate![0]!.netToHeirs).toBe(3_100_000);
      expect(ctx.charts!.estate![1]!.netToHeirs).toBe(3_900_000);
      // The bar's height is the WHOLE estate: net to heirs, plus the estate tax
      // and probate above, plus the fixture's $250K of debts. Not `taxAndCosts`,
      // which is four of the six segments.
      expect(ctx.charts!.estate![0]!.total).toBe(4_050_000);
      expect(ctx.charts!.estate![1]!.total).toBe(4_550_000);
    });

    it("builds NO third estate report for the chart — the bars come off the two it already had", async () => {
      // The whole reason this comparison was chosen over today-vs-end-of-life. A
      // third call here is one more `buildEstateTransferReportData` inside a
      // loader that already takes ~23s cold, and it would mean the bars were
      // derived a second time rather than kept.
      fx.estate = {
        base: estateReport(3_100_000, 500_000, 200_000),
        "sc-1": estateReport(3_900_000, 300_000, 100_000),
      };
      const ctx = await load();

      expect(ctx.charts?.estate).toHaveLength(2);
      expect(fx.estateCalls).toHaveLength(2);
      expect(fx.estateCalls.every((c) => c.asOf.kind === "split")).toBe(true);
    });

    it("draws no estate chart when there is no proposal to compare against", async () => {
      // A comparison chart with one bar is not a comparison. `chartFor` returns
      // null for a null array, so the chapter keeps its prose and prints no
      // empty frame. This chapter is `requiresProposal` and so never prints on
      // a base-only deck anyway — the null is the belt to that braces.
      fx.estate = { base: estateReport(3_100_000, 500_000, 200_000) };
      const ctx = await loadStoryContext({
        clientId: "c1",
        firmId: "f1",
        proposedRef: null,
        scenarioLabel: "Base Case",
        documentRole: "frontMatter",
      });

      expect(ctx.charts?.estate).toBeNull();
      // …and the base plan's own figures still reach the pack.
      expect(ctx.facts.some((f) => f.id === "estate.net.base")).toBe(true);
    });

    it("draws no estate chart when the proposed estate report is empty", async () => {
      // Half a comparison is not a comparison either, and this is the path that
      // reaches a real household: an estate on file today, a scenario that
      // empties it. A missing `fx.estate` entry comes back `isEmpty`.
      fx.estate = { base: estateReport(3_100_000, 500_000, 200_000) };
      const ctx = await load();

      expect(ctx.charts?.estate).toBeNull();
      expect(ctx.facts.some((f) => f.id === "estate.net.base")).toBe(true);
      expect(ctx.facts.some((f) => f.id === "estate.net.proposed")).toBe(false);
    });

    it("omits the estate figures for a household with nothing on file", async () => {
      // Every report comes back `isEmpty`. Absent, never $0 — "nothing reaches
      // your heirs" is a different statement from "we have no estate on file".
      const ctx = await load();
      expect(ctx.facts.some((f) => f.id.startsWith("estate."))).toBe(false);
    });

    it("sums lifetime income tax per plan, and omits it when no year carries one", async () => {
      fx.years = { base: [taxedYear(2026, 40_000), taxedYear(2027, 60_000)], "sc-1": [taxedYear(2026, 30_000)] };
      const ctx = await load();

      expect(display(ctx, "tax.lifetime.base")).toBe("$100K");
      expect(display(ctx, "tax.lifetime.proposed")).toBe("$30K");

      // …and the ordinary fixture's years carry no `taxResult` at all, which
      // sums to exactly 0 — a figure that would print as "$0 in income tax over
      // the whole plan" for a household whose tax engine simply did not run.
      fx.years = { base: BASE_YEARS, "sc-1": PROPOSED_YEARS };
      const none = await load();
      expect(none.facts.some((f) => f.id.startsWith("tax."))).toBe(false);
    });

    it("reads each plan's confidence from the compute cache under its own scenario id", async () => {
      // Both solves supplied, so the only thing that could log here is a real
      // Monte Carlo failure — which is what the last assertion is checking.
      fx.maxSpend = { base: 150_000, "sc-1": 185_000 };
      const ctx = await load();

      expect(display(ctx, "outcome.confidence.base")).toBe("72%");
      expect(display(ctx, "outcome.confidence.proposed")).toBe("91%");
      expect(display(ctx, "outcome.legacy.proposed")).toBe("$2.6M");
      // Both plans read through the cache, each under its own key, so the PDF
      // render step reuses these runs instead of simulating twice. Order is
      // incidental — the two loads race.
      expect(fx.mcCalls).toHaveLength(2);
      expect(fx.mcCalls).toEqual(
        expect.arrayContaining([
          { clientId: "c1", firmId: "f1", scenarioId: "base" },
          { clientId: "c1", firmId: "f1", scenarioId: "sc-1" },
        ]),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("never lends the base plan's confidence to a snapshot proposal", async () => {
      // `resolveScenarioRef` turns a "snap:" ref into a SNAPSHOT — a frozen
      // tree with no scenario row, so nothing can be keyed to it. The snapshot
      // is still projected; only the figures that would have to borrow an id
      // are withheld.
      fx.years = { base: BASE_YEARS, "snap-1": PROPOSED_YEARS };
      fx.mc = { base: 0.72 };

      const ctx = await loadStoryContext({
        clientId: "c1",
        firmId: "f1",
        proposedRef: "snap:snap-1",
        scenarioLabel: "Last year's plan",
        documentRole: "frontMatter",
      });

      expect(display(ctx, "outcome.confidence.base")).toBe("72%");
      // The base rate must NOT reappear as the proposal's.
      expect(ctx.facts.some((f) => f.id === "outcome.confidence.proposed")).toBe(false);
      // Nothing was keyed to a scenario id the snapshot does not have.
      expect(fx.mcCalls).toEqual([{ clientId: "c1", firmId: "f1", scenarioId: "base" }]);
      expect(fx.changeQueries).toEqual([]);
      expect(ctx.strategies).toEqual([]);
      // What the snapshot's own tree does say is still reported.
      expect(display(ctx, "outcome.legacy.proposed")).toBe("$2.6M");
      expect(ctx.hasProposal).toBe(true);
    });

    /**
     * `willTheMoneyLast` prints under both `OUTCOME_CHAPTERS` and
     * `PROPOSED_OUTCOME_CHAPTERS`, so on a deck carrying a proposal it already
     * states the proposed plan's outcome — the chart it draws has to match.
     * `outcome.legacy.base` stays the CURRENT plan's ending balance no matter
     * what (`build-facts.ts`'s own rule), so the two figures below are
     * required to differ; if the loader fed the chart builder the base years
     * instead of the proposed ones, they would come out equal.
     */
    it("draws the chart from the PROPOSED plan's years, not the base plan's", async () => {
      const ctx = await load();

      // Base plan's 2065: $900K taxable + $100K cash + $1.0M retirement = $2.0M.
      expect(display(ctx, "outcome.legacy.base")).toBe("$2.0M");
      // Proposed plan's 2065: $1.2M taxable + $100K cash + $1.3M retirement = $2.6M.
      expect(display(ctx, "chart.portfolio.atEnd")).toBe("$2.6M");
      expect(ctx.charts?.portfolio[ctx.charts.portfolio.length - 1]?.total).toBe(2_600_000);
    });

    it("keeps the proposed plan's figures when only its Monte Carlo fails", async () => {
      fx.mc = { base: 0.72 };

      const ctx = await load();

      expect(display(ctx, "outcome.confidence.base")).toBe("72%");
      expect(ctx.facts.some((f) => f.id === "outcome.confidence.proposed")).toBe(false);
      expect(display(ctx, "outcome.legacy.proposed")).toBe("$2.6M");
      expect(ctx.strategies).toHaveLength(2);
    });
  });
});
