import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted, not a bare top-level const: `vi.mock` factories run during ESM
// import evaluation, before this file's own top-level statements (T1 — three
// prior tasks on this branch transcribed the bare-const version and hit a
// temporal-dead-zone throw). Every mock fn a test body reconfigures lives
// here. `dbRows` is a plain (non-fn) hoisted handle so the `@/db` mock (C6)
// can return a roster a test controls, instead of the brief's unconditional
// `[]` that makes list_scenarios' not-in-roster branch unreachable.
const {
  loadEffectiveTree,
  loadPanelData,
  loadProjectionForRef,
  getOrComputeMonteCarlo,
  runProjectionWithEvents,
  summarizeMonteCarlo,
  verifyClientAccessFor,
  dbRows,
} = vi.hoisted(() => ({
  loadEffectiveTree: vi.fn(),
  loadPanelData: vi.fn(),
  loadProjectionForRef: vi.fn(),
  getOrComputeMonteCarlo: vi.fn(),
  runProjectionWithEvents: vi.fn(),
  summarizeMonteCarlo: vi.fn(),
  verifyClientAccessFor: vi.fn(),
  dbRows: { current: [] as Record<string, unknown>[] },
}));

vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree }));
vi.mock("@/lib/scenario/load-panel-data", () => ({ loadPanelData }));
vi.mock("@/lib/scenario/load-projection-for-ref", () => ({ loadProjectionForRef }));
vi.mock("@/lib/compute-cache/monte-carlo", () => ({ getOrComputeMonteCarlo }));
vi.mock("@/engine", () => ({ runProjectionWithEvents, summarizeMonteCarlo }));
// C6 (R53): the roster query result is reconfigurable per test via `dbRows`,
// not the brief's unconditional `[]` — otherwise list_scenarios' not-in-
// roster branch can never be reached.
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => dbRows.current }) }) },
}));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { planTools } from "../tools/plan";
import type { McpPrincipal } from "@/lib/mcp/principal";

// tokenSubject deliberately differs from userId, mirroring the other MCP
// fixtures: a handler that read principal.tokenSubject instead of
// principal.userId would pass every case here undetected if the two collided.
const principal: McpPrincipal = {
  userId: "user_1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "sub_1",
};
const byName = (n: string) => planTools.find((t) => t.name === n)!;

const DENIED_MESSAGE = "Household not found or access denied";

/**
 * A realistic ProjectionYear-shaped fixture: `portfolioAssets` carries
 * account-UUID-keyed maps (per C5, a fixture that is already a scalar cannot
 * catch C2/C3) plus a `total` distinct from every other number in the
 * fixture, so a C2/C3 regression that returns the whole object (or the wrong
 * number) is caught rather than coincidentally matching.
 */
function makeYear(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    year: 2030,
    ages: { client: 60 },
    income: { total: 10 },
    expenses: { total: 5 },
    netCashFlow: 5,
    taxResult: { flow: { totalTax: 1_234 } },
    medicare: { totalAnnualCost: 200, totalIrmaaSurcharge: 50 },
    taxDetail: { ordinaryIncome: 100 },
    portfolioAssets: {
      taxable: { "11111111-1111-1111-1111-111111111111": 100_000 },
      cash: { "22222222-2222-2222-2222-222222222222": 20_000 },
      retirement: { "33333333-3333-3333-3333-333333333333": 300_000 },
      taxableTotal: 100_000,
      cashTotal: 20_000,
      retirementTotal: 300_000,
      total: 555_555,
    },
    ...overrides,
  };
}

beforeEach(() => {
  loadEffectiveTree.mockReset();
  loadPanelData.mockReset();
  loadPanelData.mockResolvedValue(null);
  loadProjectionForRef.mockReset();
  getOrComputeMonteCarlo.mockReset();
  runProjectionWithEvents.mockReset();
  summarizeMonteCarlo.mockReset();
  verifyClientAccessFor.mockReset();
  verifyClientAccessFor.mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
  dbRows.current = [];
});

describe("schema and metadata (T3)", () => {
  it("every plan tool declares clientId in its schema, so the per-client authz gate always fires", () => {
    for (const tool of planTools) {
      expect("clientId" in tool.inputSchema.shape).toBe(true);
    }
  });

  it("every plan tool carries read-only annotations, a real title and a real description", () => {
    for (const tool of planTools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(tool.title).toMatch(/\S/);
      expect(tool.description).toMatch(/\S/);
    }
  });
});

describe("list_scenarios", () => {
  it("lists the roster with no detail when scenarioId is omitted", async () => {
    dbRows.current = [
      { id: "base", name: "Base Case", isBaseCase: true },
      { id: "s1", name: "Retire Early", isBaseCase: false },
    ];
    const out = (await byName("list_scenarios").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    expect(out.scenarios).toEqual(dbRows.current);
    expect(out).not.toHaveProperty("detail");
    expect(loadPanelData).not.toHaveBeenCalled();
  });

  it("returns a not-in-roster note when the scenarioId isn't in this household's roster", async () => {
    dbRows.current = [{ id: "base", name: "Base Case", isBaseCase: true }];
    const out = (await byName("list_scenarios").run(
      { clientId: "c1", scenarioId: "ghost" },
      principal,
    )) as Record<string, unknown>;
    expect(out.detail).toBeNull();
    expect(out.note).toBe("scenario ghost is not in this household's roster");
    expect(loadPanelData).not.toHaveBeenCalled();
  });

  it("returns a no-change-detail note when the scenario is in the roster but loadPanelData resolves null (base case)", async () => {
    dbRows.current = [{ id: "base", name: "Base Case", isBaseCase: true }];
    loadPanelData.mockResolvedValue(null);
    const out = (await byName("list_scenarios").run(
      { clientId: "c1", scenarioId: "base" },
      principal,
    )) as Record<string, unknown>;
    expect(loadPanelData).toHaveBeenCalledWith("c1", "base", "org_1");
    expect(out.detail).toBeNull();
    expect(out.note).toBe("scenario base has no change detail (base case or unavailable)");
  });

  it("returns the scenario's changes and toggle groups when loadPanelData resolves real detail", async () => {
    dbRows.current = [{ id: "s1", name: "Retire Early", isBaseCase: false }];
    loadPanelData.mockResolvedValue({
      scenarioId: "s1",
      scenarioName: "Retire Early",
      changes: [{ id: "chg1", targetKind: "income" }],
      toggleGroups: [{ id: "g1", name: "Sell rental" }],
      cascadeWarnings: [{ kind: "note" }],
      targetNames: { "income:i1": "Salary" },
    });
    const out = (await byName("list_scenarios").run(
      { clientId: "c1", scenarioId: "s1" },
      principal,
    )) as Record<string, unknown>;
    // Only scenarioId/scenarioName/changes/toggleGroups pass through — NOT
    // cascadeWarnings/targetNames, which loadPanelData also carries.
    expect(out.detail).toEqual({
      scenarioId: "s1",
      scenarioName: "Retire Early",
      changes: [{ id: "chg1", targetKind: "income" }],
      toggleGroups: [{ id: "g1", name: "Sell rental" }],
    });
    expect(out).not.toHaveProperty("note");
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("list_scenarios").run({ clientId: "c1" }, principal)).rejects.toThrow(DENIED_MESSAGE);
  });
});

describe("compare_scenarios", () => {
  it("resolves 'base' to a scenario ref with an empty toggleState (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "Base case", result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "base", right: "base" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", {
      kind: "scenario", id: "base", toggleState: {},
    });
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(2, "c1", "org_1", {
      kind: "scenario", id: "base", toggleState: {},
    });
  });

  it("resolves a live scenario id token to a scenario ref carrying that id (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "X", result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "s1", right: "base" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", {
      kind: "scenario", id: "s1", toggleState: {},
    });
  });

  it("resolves a snap: token to a snapshot ref carrying the id and the correct side (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "Snap", result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "snap:abc", right: "snap:xyz" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", {
      kind: "snapshot", id: "abc", side: "left",
    });
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(2, "c1", "org_1", {
      kind: "snapshot", id: "xyz", side: "right",
    });
  });

  it("resolves 'do-nothing' to the do-nothing ref, not a scenario carrying that literal id (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "Do nothing", result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "do-nothing", right: "base" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", { kind: "do-nothing" });
  });

  it("returns endingPortfolio as the scalar .total, not the account-keyed map, for both sides (C2)", async () => {
    const leftYear = makeYear({ portfolioAssets: { ...(makeYear().portfolioAssets as object), total: 555_555 } });
    const rightYear = makeYear({ portfolioAssets: { ...(makeYear().portfolioAssets as object), total: 777_777 } });
    loadProjectionForRef
      .mockResolvedValueOnce({ scenarioName: "Left", result: { years: [leftYear] } })
      .mockResolvedValueOnce({ scenarioName: "Right", result: { years: [rightYear] } });
    const out = (await byName("compare_scenarios").run(
      { clientId: "c1", left: "base", right: "s2" },
      principal,
    )) as Record<string, Record<string, unknown>>;
    expect(typeof out.left.endingPortfolio).toBe("number");
    expect(out.left.endingPortfolio).toBe(555_555);
    expect(typeof out.right.endingPortfolio).toBe("number");
    expect(out.right.endingPortfolio).toBe(777_777);
  });

  it("sums lifetimeTax across years, defaulting a year with no taxResult to 0, and echoes ref + scenarioName", async () => {
    const y1 = makeYear({ year: 2030, taxResult: { flow: { totalTax: 1_000 } } });
    const y2 = makeYear({ year: 2031, taxResult: undefined });
    const y3 = makeYear({ year: 2032, taxResult: { flow: { totalTax: 2_000 } } });
    loadProjectionForRef
      .mockResolvedValueOnce({ scenarioName: "Left Plan", result: { years: [y1, y2, y3] } })
      .mockResolvedValueOnce({ scenarioName: "Right Plan", result: { years: [] } });
    const out = (await byName("compare_scenarios").run(
      { clientId: "c1", left: "left-token", right: "right-token" },
      principal,
    )) as Record<string, Record<string, unknown>>;
    expect(out.left).toEqual({
      ref: "left-token", scenarioName: "Left Plan", lifetimeTax: 3_000, endingPortfolio: 555_555,
    });
    expect(out.right).toEqual({
      ref: "right-token", scenarioName: "Right Plan", lifetimeTax: 0, endingPortfolio: 0,
    });
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(
      byName("compare_scenarios").run({ clientId: "c1", left: "base", right: "base" }, principal),
    ).rejects.toThrow(DENIED_MESSAGE);
    expect(loadProjectionForRef).not.toHaveBeenCalled();
  });
});

describe("run_projection", () => {
  it("returns compacted years, echoes the scenario it used, and extracts death years", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "bracket" }, taxYearRows: [{}] },
    });
    runProjectionWithEvents.mockReturnValue({
      years: [makeYear()],
      firstDeathEvent: { year: 2045, deathOrder: 1 },
      giftLedger: [],
    });
    const out = (await byName("run_projection").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    expect(out.scenarioId).toBe("base");
    expect(out.taxGrounded).toBe(true);
    expect(out.firstDeathYear).toBe(2045);
    expect(out.secondDeathYear).toBeNull();
    expect((out.years as unknown[])[0]).toEqual({
      year: 2030,
      ages: { client: 60 },
      totalIncome: 10,
      totalExpenses: 5,
      netCashFlow: 5,
      totalTax: 1_234,
      medicareTotal: 200,
      irmaaSurcharge: 50,
      portfolioAssets: 555_555,
    });
  });

  it("flags taxGrounded false in flat mode, and both death years null when neither event fired", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "flat" }, taxYearRows: [] },
    });
    runProjectionWithEvents.mockReturnValue({ years: [makeYear()], giftLedger: [] });
    const out = (await byName("run_projection").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    expect(out.taxGrounded).toBe(false);
    expect(out.firstDeathYear).toBeNull();
    expect(out.secondDeathYear).toBeNull();
  });

  it("reduces portfolioAssets to the scalar total for every year, never the raw account-keyed map (C3)", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "bracket" }, taxYearRows: [{}] },
    });
    const y1 = makeYear({ year: 2030 });
    const y2 = makeYear({ year: 2031, portfolioAssets: { ...(makeYear().portfolioAssets as object), total: 999_999 } });
    runProjectionWithEvents.mockReturnValue({ years: [y1, y2], giftLedger: [] });
    const out = (await byName("run_projection").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    const years = out.years as Record<string, unknown>[];
    expect(typeof years[0].portfolioAssets).toBe("number");
    expect(years[0].portfolioAssets).toBe(555_555);
    expect(typeof years[1].portfolioAssets).toBe("number");
    expect(years[1].portfolioAssets).toBe(999_999);
  });

  it("passes scenarioId through to loadEffectiveTree, defaulting to base", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { planSettings: {}, taxYearRows: [] } });
    runProjectionWithEvents.mockReturnValue({ years: [], giftLedger: [] });
    await byName("run_projection").run({ clientId: "c1" }, principal);
    expect(loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "base", {});

    loadEffectiveTree.mockClear();
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { planSettings: {}, taxYearRows: [] } });
    await byName("run_projection").run({ clientId: "c1", scenarioId: "s9" }, principal);
    expect(loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "s9", {});
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("run_projection").run({ clientId: "c1" }, principal)).rejects.toThrow(DENIED_MESSAGE);
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });
});

describe("get_tax_projection", () => {
  const fiveYears = [2028, 2029, 2030, 2031, 2032].map((year) =>
    makeYear({ year, taxResult: { flow: { totalTax: year * 10 } } }),
  );

  it("returns every year with taxGrounded true when no start/end filter is given", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "bracket" }, taxYearRows: [{}] },
    });
    runProjectionWithEvents.mockReturnValue({ years: fiveYears });
    const out = (await byName("get_tax_projection").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.taxGrounded).toBe(true);
    expect((out.years as unknown[]).map((y) => (y as { year: number }).year)).toEqual([
      2028, 2029, 2030, 2031, 2032,
    ]);
  });

  it("filters years by an inclusive startYear/endYear boundary", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "bracket" }, taxYearRows: [{}] },
    });
    runProjectionWithEvents.mockReturnValue({ years: fiveYears });
    const out = (await byName("get_tax_projection").run(
      { clientId: "c1", startYear: 2029, endYear: 2031 },
      principal,
    )) as Record<string, unknown>;
    // Inclusive on both ends: 2029 and 2031 themselves must survive, not just
    // the interior 2030.
    expect((out.years as unknown[]).map((y) => (y as { year: number }).year)).toEqual([2029, 2030, 2031]);
  });

  it("flags taxGrounded false in flat mode", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "flat" }, taxYearRows: [{}] },
    });
    runProjectionWithEvents.mockReturnValue({ years: fiveYears });
    const out = (await byName("get_tax_projection").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.taxGrounded).toBe(false);
  });

  it("shapes each row's totalTax, taxDetail and medicare, and defaults missing medicare to null", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { planSettings: { taxEngineMode: "bracket" }, taxYearRows: [{}] },
    });
    runProjectionWithEvents.mockReturnValue({
      years: [makeYear({ year: 2030, medicare: undefined, taxDetail: undefined })],
    });
    const out = (await byName("get_tax_projection").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect((out.years as unknown[])[0]).toEqual({
      year: 2030,
      ages: { client: 60 },
      totalTax: 1_234,
      taxDetail: null,
      medicare: null,
    });
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("get_tax_projection").run({ clientId: "c1" }, principal)).rejects.toThrow(
      DENIED_MESSAGE,
    );
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });
});

describe("get_monte_carlo", () => {
  it("returns the success rate and percentile bands from cache", async () => {
    getOrComputeMonteCarlo.mockResolvedValue({
      // C4 (R50): the real CachedMonteCarloResult carries `payload` too — the
      // brief's mock encoded a false contract even though the handler only
      // reads `.raw`/`.meta`.
      payload: { available: true },
      raw: {},
      meta: { startingLiquidBalance: 1_000_000 },
    });
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { client: {}, planSettings: {} } });
    summarizeMonteCarlo.mockReturnValue({
      requestedTrials: 1000, trialsRun: 1000, aborted: false,
      successRate: 0.91, failureRate: 0.09,
      ending: { p5: 1, p20: 2, p50: 3, p80: 4, p95: 5, min: 0, max: 6, mean: 3 },
      byYear: [],
    });
    const out = (await byName("get_monte_carlo").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    expect(typeof out.successRate).toBe("number");
    expect(out.successRate).toBe(0.91);
    expect(out.failureRate).toBe(0.09);
    expect(out.trialsRun).toBe(1000);
    expect(out.requestedTrials).toBe(1000);
    expect(out.ending).toEqual({ p5: 1, p20: 2, p50: 3, p80: 4, p95: 5, min: 0, max: 6, mean: 3 });
  });

  it("does not force a refresh unless asked", async () => {
    getOrComputeMonteCarlo.mockResolvedValue({ payload: {}, raw: {}, meta: { startingLiquidBalance: 0 } });
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { client: {}, planSettings: {} } });
    summarizeMonteCarlo.mockReturnValue({
      requestedTrials: 1, trialsRun: 1, aborted: false, successRate: 1, failureRate: 0,
      ending: { p5: 0, p20: 0, p50: 0, p80: 0, p95: 0, min: 0, max: 0, mean: 0 }, byYear: [],
    });
    await byName("get_monte_carlo").run({ clientId: "c1" }, principal);
    expect(getOrComputeMonteCarlo.mock.calls[0][0].forceRefresh).toBe(false);
  });

  it("forces a refresh when asked, on the same scenario passed to loadEffectiveTree", async () => {
    getOrComputeMonteCarlo.mockResolvedValue({ payload: {}, raw: {}, meta: { startingLiquidBalance: 0 } });
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { client: {}, planSettings: {} } });
    summarizeMonteCarlo.mockReturnValue({
      requestedTrials: 1, trialsRun: 1, aborted: false, successRate: 1, failureRate: 0,
      ending: { p5: 0, p20: 0, p50: 0, p80: 0, p95: 0, min: 0, max: 0, mean: 0 }, byYear: [],
    });
    await byName("get_monte_carlo").run({ clientId: "c1", scenarioId: "s5", refresh: true }, principal);
    expect(getOrComputeMonteCarlo.mock.calls[0][0]).toEqual({
      clientId: "c1", firmId: "org_1", scenarioId: "s5", forceRefresh: true,
    });
    expect(loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "s5", {});
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("get_monte_carlo").run({ clientId: "c1" }, principal)).rejects.toThrow(DENIED_MESSAGE);
    expect(getOrComputeMonteCarlo).not.toHaveBeenCalled();
  });
});

describe("get_estate_summary", () => {
  it("returns the full death-event detail, hypothetical tax, gift ledger, entities and wills", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { entities: [{ id: "e1", name: "Family Trust" }], wills: [{ id: "w1", grantor: "client" }] },
    });
    const firstDeath = { year: 2045, deathOrder: 1, grossEstateLines: [{ label: "Brokerage", amount: 500_000 }] };
    const secondDeath = { year: 2050, deathOrder: 2, grossEstateLines: [] };
    runProjectionWithEvents.mockReturnValue({
      years: [],
      firstDeathEvent: firstDeath,
      secondDeathEvent: secondDeath,
      todayHypotheticalEstateTax: { totalEstateTax: 42_000 },
      giftLedger: [{ year: 2030, giftsGiven: 15_000 }],
    });
    const out = (await byName("get_estate_summary").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.firstDeath).toEqual(firstDeath);
    expect(out.secondDeath).toEqual(secondDeath);
    expect(out.todayHypotheticalEstateTax).toEqual({ totalEstateTax: 42_000 });
    expect(out.giftLedger).toEqual([{ year: 2030, giftsGiven: 15_000 }]);
    expect(out.entities).toEqual([{ id: "e1", name: "Family Trust" }]);
    expect(out.wills).toEqual([{ id: "w1", grantor: "client" }]);
  });

  it("returns null death events and empty entities/wills when the plan has neither death nor either array", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: {} });
    runProjectionWithEvents.mockReturnValue({
      years: [],
      firstDeathEvent: undefined,
      secondDeathEvent: undefined,
      todayHypotheticalEstateTax: { totalEstateTax: 0 },
      giftLedger: [],
    });
    const out = (await byName("get_estate_summary").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.firstDeath).toBeNull();
    expect(out.secondDeath).toBeNull();
    expect(out.entities).toEqual([]);
    expect(out.wills).toEqual([]);
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("get_estate_summary").run({ clientId: "c1" }, principal)).rejects.toThrow(
      DENIED_MESSAGE,
    );
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });
});
