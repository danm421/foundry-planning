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
}));

vi.mock("@/lib/scenario/loader", () => ({
  // The fake tree carries the ref's id so the projection mock can hand back a
  // different set of years per scenario.
  loadEffectiveTreeForRef: vi.fn(
    async (_clientId: string, _firmId: string, ref: { id: string }) => ({
      effectiveTree: { client: fx.client, accounts: fx.accounts, scenarioId: ref.id },
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
