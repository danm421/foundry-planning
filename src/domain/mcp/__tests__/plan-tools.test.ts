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
// roster branch can never be reached. Chain now ends in `.orderBy()` (fold-in
// fix: the real query gained a stable sort order), so the mock's chain must
// carry that extra link too or the real handler throws "orderBy is not a
// function".
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => dbRows.current }) }) }) },
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

/** A tree just complete enough that isTaxGrounded(tree) doesn't crash. */
const BRACKET_TREE = { planSettings: { taxEngineMode: "bracket" }, taxYearRows: [{}] };
const FLAT_TREE = { planSettings: { taxEngineMode: "flat" }, taxYearRows: [] };

/**
 * A realistic ProjectionYear-shaped fixture. Every leaf number below is
 * distinct from every other leaf number in the object (fold-in: the prior
 * round's `expenses.total = 5` colliding with `netCashFlow = 5` meant a
 * field-swap bug between the two couldn't be caught). `portfolioAssets`
 * carries account-UUID-keyed maps plus BOTH `total` (F1: the legacy
 * IIP-only figure — must never be read) and `liquidTotal` (F1: the
 * canonical figure — must be read), with distinct values so a regression
 * back to `.total` is caught. `taxDetail` carries a realistic `bySource`
 * map keyed by raw ids (F3) alongside its scalar buckets.
 */
function makeYear(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    year: 2030,
    ages: { client: 60 },
    income: { total: 420_000 },
    expenses: { total: 260_000 },
    netCashFlow: 160_000,
    taxResult: { flow: { totalTax: 91_000, totalFederalTax: 71_000, stateTax: 20_000 } },
    medicare: { totalAnnualCost: 8_400, totalIrmaaSurcharge: 1_100 },
    taxDetail: {
      earnedIncome: 310_000,
      ordinaryIncome: 265_000,
      dividends: 12_500,
      capitalGains: 26_000,
      stCapitalGains: 3_300,
      qbi: 4_400,
      taxExempt: 1_700,
      taxExemptInterest: 950,
      bySource: {
        "44444444-4444-4444-4444-444444444444": { type: "ordinary_income", amount: 258_000 },
      },
    },
    portfolioAssets: {
      taxable: { "11111111-1111-1111-1111-111111111111": 1_010_000 },
      cash: { "22222222-2222-2222-2222-222222222222": 152_000 },
      retirement: { "33333333-3333-3333-3333-333333333333": 905_000 },
      taxableTotal: 1_010_000,
      cashTotal: 152_000,
      retirementTotal: 905_000,
      total: 3_160_000,
      liquidTotal: 2_460_000,
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

  it("projects each change to field/entity names + a description, never the raw payload (F2)", async () => {
    dbRows.current = [{ id: "s1", name: "Retire Early", isBaseCase: false }];
    const targetNames = {
      "income:i1": "Salary", "account:a1": "401k", "expense:e1": "Travel", "liability:l1": "Mortgage",
    };
    loadPanelData.mockResolvedValue({
      scenarioId: "s1",
      scenarioName: "Retire Early",
      changes: [
        {
          id: "c1", scenarioId: "s1", opType: "add", targetKind: "income", targetId: "i1",
          payload: { id: "i1", name: "Consulting", amount: 50_000 },
          toggleGroupId: null, orderIndex: 0, updatedAt: new Date("2026-01-01"), enabled: true, label: null,
        },
        {
          id: "c2", scenarioId: "s1", opType: "remove", targetKind: "account", targetId: "a1",
          payload: null, toggleGroupId: null, orderIndex: 1, updatedAt: new Date("2026-01-01"),
          enabled: true, label: null,
        },
        {
          id: "c3", scenarioId: "s1", opType: "edit", targetKind: "expense", targetId: "e1",
          payload: { amount: { from: 1_000, to: 1_500 }, startYear: { from: 2030, to: 2031 } },
          toggleGroupId: null, orderIndex: 2, updatedAt: new Date("2026-01-01"),
          enabled: true, label: "Bumped travel",
        },
        {
          // Single-field edit on a NON-sensitive field — describeChangeUnit's
          // single-field branch would be safe here too; describeChange must
          // still produce the same value-free wording either way.
          id: "c4", scenarioId: "s1", opType: "edit", targetKind: "liability", targetId: "l1",
          payload: { interestRate: { from: 0.05, to: 0.045 } },
          toggleGroupId: "g1", orderIndex: 3, updatedAt: new Date("2026-01-01"),
          enabled: false, label: null,
        },
      ],
      toggleGroups: [{ id: "g1", name: "Refi", scenarioId: "s1", defaultOn: true, requiresGroupId: null, orderIndex: 0 }],
      cascadeWarnings: [],
      targetNames,
    });
    const out = (await byName("list_scenarios").run(
      { clientId: "c1", scenarioId: "s1" },
      principal,
    )) as Record<string, unknown>;
    const detail = out.detail as { changes: Record<string, unknown>[] };
    expect(detail.changes).toEqual([
      { id: "c1", opType: "add", targetKind: "income", targetId: "i1", label: null, enabled: true, toggleGroupId: null, orderIndex: 0, description: "Added: Salary." },
      { id: "c2", opType: "remove", targetKind: "account", targetId: "a1", label: null, enabled: true, toggleGroupId: null, orderIndex: 1, description: "Removed: 401k." },
      { id: "c3", opType: "edit", targetKind: "expense", targetId: "e1", label: "Bumped travel", enabled: true, toggleGroupId: null, orderIndex: 2, description: "Changed 2 fields on Travel: amount, startYear." },
      { id: "c4", opType: "edit", targetKind: "liability", targetId: "l1", label: null, enabled: false, toggleGroupId: "g1", orderIndex: 3, description: "Changed interestRate on Mortgage." },
    ]);
    for (const row of detail.changes) expect(row).not.toHaveProperty("payload");
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("Consulting");
    expect(serialized).not.toContain("0.045");
  });

  it("never lets a scenario-change VALUE reach the payload, even for a single-field DOB edit (F2 addendum)", async () => {
    dbRows.current = [{ id: "s1", name: "Retire Early", isBaseCase: false }];
    loadPanelData.mockResolvedValue({
      scenarioId: "s1",
      scenarioName: "Retire Early",
      changes: [
        {
          id: "c9", scenarioId: "s1", opType: "edit", targetKind: "family_member", targetId: "fm1",
          payload: { dateOfBirth: { from: "1961-05-04", to: "1962-05-04" } },
          toggleGroupId: null, orderIndex: 0, updatedAt: new Date("2026-01-01"), enabled: true, label: null,
        },
      ],
      toggleGroups: [],
      cascadeWarnings: [],
      targetNames: { "family_member:fm1": "Jane Smith" },
    });
    const out = (await byName("list_scenarios").run(
      { clientId: "c1", scenarioId: "s1" },
      principal,
    )) as Record<string, unknown>;
    const detail = out.detail as { changes: Array<{ description: string }> };
    expect(detail.changes[0].description).toBe("Changed dateOfBirth on Jane Smith.");
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("1961-05-04");
    expect(serialized).not.toContain("1962-05-04");
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("list_scenarios").run({ clientId: "c1" }, principal)).rejects.toThrow(DENIED_MESSAGE);
  });
});

describe("compare_scenarios", () => {
  it("resolves 'base' to a scenario ref with an empty toggleState (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "Base case", tree: {}, result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "base", right: "base" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", {
      kind: "scenario", id: "base", toggleState: {},
    });
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(2, "c1", "org_1", {
      kind: "scenario", id: "base", toggleState: {},
    });
  });

  it("resolves a live scenario id token to a scenario ref carrying that id (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "X", tree: {}, result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "s1", right: "base" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", {
      kind: "scenario", id: "s1", toggleState: {},
    });
  });

  it("resolves a snap: token to a snapshot ref carrying the id and the correct side (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "Snap", tree: {}, result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "snap:abc", right: "snap:xyz" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", {
      kind: "snapshot", id: "abc", side: "left",
    });
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(2, "c1", "org_1", {
      kind: "snapshot", id: "xyz", side: "right",
    });
  });

  it("resolves 'do-nothing' to the do-nothing ref, not a scenario carrying that literal id (C1)", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "Do nothing", tree: {}, result: { years: [makeYear()] } });
    await byName("compare_scenarios").run({ clientId: "c1", left: "do-nothing", right: "base" }, principal);
    expect(loadProjectionForRef).toHaveBeenNthCalledWith(1, "c1", "org_1", { kind: "do-nothing" });
  });

  it("returns endingPortfolio as the scalar .liquidTotal, never the legacy .total (F1/C2)", async () => {
    const leftYear = makeYear({
      portfolioAssets: { ...(makeYear().portfolioAssets as object), total: 9_000_000, liquidTotal: 555_555 },
    });
    const rightYear = makeYear({
      portfolioAssets: { ...(makeYear().portfolioAssets as object), total: 1_000, liquidTotal: 777_777 },
    });
    loadProjectionForRef
      .mockResolvedValueOnce({ scenarioName: "Left", tree: {}, result: { years: [leftYear] } })
      .mockResolvedValueOnce({ scenarioName: "Right", tree: {}, result: { years: [rightYear] } });
    const out = (await byName("compare_scenarios").run(
      { clientId: "c1", left: "base", right: "s2" },
      principal,
    )) as Record<string, Record<string, unknown>>;
    expect(typeof out.left.endingPortfolio).toBe("number");
    expect(out.left.endingPortfolio).toBe(555_555);
    expect(typeof out.right.endingPortfolio).toBe("number");
    expect(out.right.endingPortfolio).toBe(777_777);
  });

  it("reports taxGrounded independently for each side, from each side's own tree (F4)", async () => {
    loadProjectionForRef
      .mockResolvedValueOnce({ scenarioName: "Left", tree: BRACKET_TREE, result: { years: [makeYear()] } })
      .mockResolvedValueOnce({ scenarioName: "Right", tree: FLAT_TREE, result: { years: [makeYear()] } });
    const out = (await byName("compare_scenarios").run(
      { clientId: "c1", left: "s1", right: "s2" },
      principal,
    )) as Record<string, Record<string, unknown>>;
    expect(out.left.taxGrounded).toBe(true);
    expect(out.right.taxGrounded).toBe(false);
  });

  it("sums lifetimeTax across years, defaulting a year with no taxResult to 0, and echoes ref + scenarioName", async () => {
    const y1 = makeYear({ year: 2030, taxResult: { flow: { totalTax: 1_000, totalFederalTax: 800, stateTax: 200 } } });
    const y2 = makeYear({ year: 2031, taxResult: undefined });
    const y3 = makeYear({ year: 2032, taxResult: { flow: { totalTax: 2_000, totalFederalTax: 1_500, stateTax: 500 } } });
    loadProjectionForRef
      .mockResolvedValueOnce({ scenarioName: "Left Plan", tree: BRACKET_TREE, result: { years: [y1, y2, y3] } })
      .mockResolvedValueOnce({ scenarioName: "Right Plan", tree: BRACKET_TREE, result: { years: [] } });
    const out = (await byName("compare_scenarios").run(
      { clientId: "c1", left: "left-token", right: "right-token" },
      principal,
    )) as Record<string, Record<string, unknown>>;
    expect(out.left).toEqual({
      ref: "left-token", scenarioName: "Left Plan", taxGrounded: true, lifetimeTax: 3_000, endingPortfolio: 2_460_000,
    });
    expect(out.right).toEqual({
      ref: "right-token", scenarioName: "Right Plan", taxGrounded: true, lifetimeTax: 0, endingPortfolio: 0,
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
    loadEffectiveTree.mockResolvedValue({ effectiveTree: BRACKET_TREE });
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
      totalIncome: 420_000,
      totalExpenses: 260_000,
      netCashFlow: 160_000,
      totalTax: 91_000,
      medicareTotal: 8_400,
      irmaaSurcharge: 1_100,
      // F1: .liquidTotal, never .total.
      portfolioAssets: 2_460_000,
    });
  });

  it("flags taxGrounded false in flat mode, and both death years null when neither event fired", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: FLAT_TREE });
    runProjectionWithEvents.mockReturnValue({ years: [makeYear()], giftLedger: [] });
    const out = (await byName("run_projection").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    expect(out.taxGrounded).toBe(false);
    expect(out.firstDeathYear).toBeNull();
    expect(out.secondDeathYear).toBeNull();
  });

  it("reduces portfolioAssets to the scalar .liquidTotal for every year, never .total or the raw account-keyed map (C3/F1)", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: BRACKET_TREE });
    const y1 = makeYear({ year: 2030 });
    const y2 = makeYear({
      year: 2031,
      portfolioAssets: { ...(makeYear().portfolioAssets as object), total: 111_111, liquidTotal: 999_999 },
    });
    runProjectionWithEvents.mockReturnValue({ years: [y1, y2], giftLedger: [] });
    const out = (await byName("run_projection").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    const years = out.years as Record<string, unknown>[];
    expect(typeof years[0].portfolioAssets).toBe("number");
    expect(years[0].portfolioAssets).toBe(2_460_000);
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
    makeYear({ year, taxResult: { flow: { totalTax: year * 10, totalFederalTax: year * 7, stateTax: year * 3 } } }),
  );

  it("returns every year with taxGrounded true when no start/end filter is given", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: BRACKET_TREE });
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
    loadEffectiveTree.mockResolvedValue({ effectiveTree: BRACKET_TREE });
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
    loadEffectiveTree.mockResolvedValue({ effectiveTree: FLAT_TREE });
    runProjectionWithEvents.mockReturnValue({ years: fiveYears });
    const out = (await byName("get_tax_projection").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.taxGrounded).toBe(false);
  });

  it("shapes each row with the federal/state split and a taxDetail stripped of bySource, defaulting missing medicare to null (F3 + federal/state fold-in)", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: BRACKET_TREE });
    runProjectionWithEvents.mockReturnValue({
      years: [makeYear({ year: 2030, medicare: undefined })],
    });
    const out = (await byName("get_tax_projection").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect((out.years as unknown[])[0]).toEqual({
      year: 2030,
      ages: { client: 60 },
      totalTax: 91_000,
      totalFederalTax: 71_000,
      stateTax: 20_000,
      taxDetail: {
        earnedIncome: 310_000,
        ordinaryIncome: 265_000,
        dividends: 12_500,
        capitalGains: 26_000,
        stCapitalGains: 3_300,
        qbi: 4_400,
        taxExempt: 1_700,
        taxExemptInterest: 950,
        // bySource intentionally absent — toEqual would fail if it survived.
      },
      medicare: null,
    });
    // Belt-and-suspenders: the raw entity-id-keyed source map must not
    // appear anywhere in the serialized payload.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("bySource");
    expect(serialized).not.toContain("44444444-4444-4444-4444-444444444444");
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
  it("returns the success rate, an UNEQUAL requestedTrials/trialsRun pair, and aborted (F6)", async () => {
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
      // F6: requestedTrials and trialsRun deliberately unequal, and aborted
      // true — a fixture where both equal 1000 cannot catch a field swap or
      // a dropped `aborted`.
      requestedTrials: 1000, trialsRun: 843, aborted: true,
      successRate: 0.91, failureRate: 0.09,
      ending: { p5: 1, p20: 2, p50: 3, p80: 4, p95: 5, min: 0, max: 6, mean: 3 },
      byYear: [],
    });
    const out = (await byName("get_monte_carlo").run({ clientId: "c1" }, principal)) as Record<string, unknown>;
    expect(typeof out.successRate).toBe("number");
    expect(out.successRate).toBe(0.91);
    expect(out.failureRate).toBe(0.09);
    expect(out.requestedTrials).toBe(1000);
    expect(out.trialsRun).toBe(843);
    expect(out.aborted).toBe(true);
    expect(out.ending).toEqual({ p5: 1, p20: 2, p50: 3, p80: 4, p95: 5, min: 0, max: 6, mean: 3 });
  });

  it("does not force a refresh unless asked", async () => {
    getOrComputeMonteCarlo.mockResolvedValue({ payload: {}, raw: {}, meta: { startingLiquidBalance: 0 } });
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { client: {}, planSettings: {} } });
    summarizeMonteCarlo.mockReturnValue({
      requestedTrials: 60, trialsRun: 55, aborted: false, successRate: 1, failureRate: 0,
      ending: { p5: 0, p20: 0, p50: 0, p80: 0, p95: 0, min: 0, max: 0, mean: 0 }, byYear: [],
    });
    await byName("get_monte_carlo").run({ clientId: "c1" }, principal);
    expect(getOrComputeMonteCarlo.mock.calls[0][0].forceRefresh).toBe(false);
  });

  it("forces a refresh when asked, on the same scenario passed to loadEffectiveTree", async () => {
    getOrComputeMonteCarlo.mockResolvedValue({ payload: {}, raw: {}, meta: { startingLiquidBalance: 0 } });
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { client: {}, planSettings: {} } });
    summarizeMonteCarlo.mockReturnValue({
      requestedTrials: 75, trialsRun: 68, aborted: false, successRate: 1, failureRate: 0,
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
  it("returns the full death-event detail, a reduced hypothetical, gift ledger, entities and wills", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: { entities: [{ id: "e1", name: "Family Trust" }], wills: [{ id: "w1", grantor: "client" }] },
    });
    const firstDeath = { year: 2045, deathOrder: 1, grossEstateLines: [{ label: "Brokerage", amount: 500_000 }] };
    const secondDeath = { year: 2050, deathOrder: 2, grossEstateLines: [] };
    runProjectionWithEvents.mockReturnValue({
      years: [],
      firstDeathEvent: firstDeath,
      secondDeathEvent: secondDeath,
      todayHypotheticalEstateTax: {
        year: 2026,
        primaryFirst: { firstDecedent: "client", totals: { federal: 10_000, state: 2_000, admin: 500, total: 12_500 } },
      },
      giftLedger: [{ year: 2030, giftsGiven: 15_000 }],
    });
    const out = (await byName("get_estate_summary").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.firstDeath).toEqual(firstDeath);
    expect(out.secondDeath).toEqual(secondDeath);
    expect(out.todayHypotheticalEstateTax).toEqual({
      year: 2026,
      primaryFirst: { firstDecedent: "client", totals: { federal: 10_000, state: 2_000, admin: 500, total: 12_500 } },
    });
    expect(out.giftLedger).toEqual([{ year: 2030, giftsGiven: 15_000 }]);
    expect(out.entities).toEqual([{ id: "e1", name: "Family Trust" }]);
    expect(out.wills).toEqual([{ id: "w1", grantor: "client" }]);
  });

  it("reduces todayHypotheticalEstateTax to headline totals per ordering, dropping grossEstateLines and DeathTransfer detail (F5)", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: {} });
    runProjectionWithEvents.mockReturnValue({
      years: [],
      todayHypotheticalEstateTax: {
        year: 2026,
        primaryFirst: {
          firstDecedent: "client",
          firstDeath: { grossEstateLines: [{ label: "Brokerage", accountId: "acct-1", amount: 500_000 }], totalEstateTax: 42_000 },
          finalDeath: { grossEstateLines: [], totalEstateTax: 0 },
          firstDeathTransfers: [{ recipientLabel: "Jane Smith", sourceAccountName: "Brokerage", amount: 500_000 }],
          finalDeathTransfers: [],
          totals: { federal: 30_000, state: 5_000, admin: 2_000, total: 37_000 },
        },
        spouseFirst: {
          firstDecedent: "spouse",
          firstDeath: { grossEstateLines: [{ label: "IRA", accountId: "acct-2", amount: 400_000 }], totalEstateTax: 38_000 },
          firstDeathTransfers: [{ recipientLabel: "John Smith", sourceAccountName: "IRA", amount: 400_000 }],
          totals: { federal: 28_000, state: 4_800, admin: 1_900, total: 34_700 },
        },
      },
      giftLedger: [],
    });
    const out = (await byName("get_estate_summary").run({ clientId: "c1" }, principal)) as Record<
      string,
      unknown
    >;
    expect(out.todayHypotheticalEstateTax).toEqual({
      year: 2026,
      primaryFirst: { firstDecedent: "client", totals: { federal: 30_000, state: 5_000, admin: 2_000, total: 37_000 } },
      spouseFirst: { firstDecedent: "spouse", totals: { federal: 28_000, state: 4_800, admin: 1_900, total: 34_700 } },
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("grossEstateLines");
    expect(serialized).not.toContain("Brokerage");
    expect(serialized).not.toContain("Jane Smith");
    expect(serialized).not.toContain("500000");
  });

  it("returns null death events, no spouseFirst, and empty entities/wills when the plan has none of them", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: {} });
    runProjectionWithEvents.mockReturnValue({
      years: [],
      firstDeathEvent: undefined,
      secondDeathEvent: undefined,
      todayHypotheticalEstateTax: {
        year: 2026,
        primaryFirst: { firstDecedent: "client", totals: { federal: 0, state: 0, admin: 0, total: 0 } },
      },
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
    expect(out.todayHypotheticalEstateTax).not.toHaveProperty("spouseFirst");
  });

  it("rejects when the caller cannot access the household", async () => {
    verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(byName("get_estate_summary").run({ clientId: "c1" }, principal)).rejects.toThrow(
      DENIED_MESSAGE,
    );
    expect(loadEffectiveTree).not.toHaveBeenCalled();
  });
});

describe("top-level key sets are pinned (F7)", () => {
  it("list_scenarios: no scenarioId", async () => {
    dbRows.current = [{ id: "base", name: "Base", isBaseCase: true }];
    const out = (await byName("list_scenarios").run({ clientId: "c1" }, principal)) as object;
    expect(Object.keys(out).sort()).toEqual(["foundryUrl", "scenarios"]);
  });

  it("list_scenarios: scenarioId with real detail", async () => {
    dbRows.current = [{ id: "s1", name: "S1", isBaseCase: false }];
    loadPanelData.mockResolvedValue({
      scenarioId: "s1", scenarioName: "S1", changes: [], toggleGroups: [],
      cascadeWarnings: [], targetNames: {},
    });
    const out = (await byName("list_scenarios").run({ clientId: "c1", scenarioId: "s1" }, principal)) as object;
    expect(Object.keys(out).sort()).toEqual(["detail", "foundryUrl", "scenarios"]);
  });

  it("list_scenarios: not-in-roster / no-change-detail note branches", async () => {
    dbRows.current = [{ id: "base", name: "Base", isBaseCase: true }];
    const out = (await byName("list_scenarios").run(
      { clientId: "c1", scenarioId: "ghost" },
      principal,
    )) as object;
    expect(Object.keys(out).sort()).toEqual(["detail", "foundryUrl", "note", "scenarios"]);
  });

  it("compare_scenarios", async () => {
    loadProjectionForRef.mockResolvedValue({ scenarioName: "X", tree: BRACKET_TREE, result: { years: [makeYear()] } });
    const out = (await byName("compare_scenarios").run(
      { clientId: "c1", left: "base", right: "base" },
      principal,
    )) as Record<string, object>;
    expect(Object.keys(out).sort()).toEqual(["foundryUrl", "left", "right"]);
    expect(Object.keys(out.left).sort()).toEqual(
      ["endingPortfolio", "lifetimeTax", "ref", "scenarioName", "taxGrounded"].sort(),
    );
  });

  it("run_projection", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: BRACKET_TREE });
    runProjectionWithEvents.mockReturnValue({ years: [makeYear()], giftLedger: [] });
    const out = (await byName("run_projection").run({ clientId: "c1" }, principal)) as object;
    expect(Object.keys(out).sort()).toEqual(
      ["firstDeathYear", "foundryUrl", "scenarioId", "secondDeathYear", "taxGrounded", "years"].sort(),
    );
  });

  it("get_tax_projection", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: BRACKET_TREE });
    runProjectionWithEvents.mockReturnValue({ years: [makeYear()] });
    const out = (await byName("get_tax_projection").run({ clientId: "c1" }, principal)) as object;
    expect(Object.keys(out).sort()).toEqual(["foundryUrl", "scenarioId", "taxGrounded", "years"].sort());
  });

  it("get_monte_carlo", async () => {
    getOrComputeMonteCarlo.mockResolvedValue({ payload: {}, raw: {}, meta: { startingLiquidBalance: 0 } });
    loadEffectiveTree.mockResolvedValue({ effectiveTree: { client: {}, planSettings: {} } });
    summarizeMonteCarlo.mockReturnValue({
      requestedTrials: 5, trialsRun: 4, aborted: false, successRate: 1, failureRate: 0,
      ending: { p5: 0, p20: 0, p50: 0, p80: 0, p95: 0, min: 0, max: 0, mean: 0 }, byYear: [],
    });
    const out = (await byName("get_monte_carlo").run({ clientId: "c1" }, principal)) as object;
    expect(Object.keys(out).sort()).toEqual(
      ["aborted", "byYear", "ending", "failureRate", "foundryUrl", "requestedTrials", "scenarioId", "successRate", "trialsRun"].sort(),
    );
  });

  it("get_estate_summary", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: {} });
    runProjectionWithEvents.mockReturnValue({
      years: [],
      todayHypotheticalEstateTax: {
        year: 2026,
        primaryFirst: { firstDecedent: "client", totals: { federal: 0, state: 0, admin: 0, total: 0 } },
      },
      giftLedger: [],
    });
    const out = (await byName("get_estate_summary").run({ clientId: "c1" }, principal)) as object;
    expect(Object.keys(out).sort()).toEqual(
      ["entities", "firstDeath", "foundryUrl", "giftLedger", "scenarioId", "secondDeath", "todayHypotheticalEstateTax", "wills"].sort(),
    );
  });
});
