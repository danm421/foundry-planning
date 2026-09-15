import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted, not a bare top-level const (C8): `vi.mock` factories hoist above
// this file's own consts and run during ESM import evaluation — a plain
// `const loadEffectiveTree = vi.fn()` referenced inside the mock factory below
// throws a temporal-dead-zone error. Copies the working pattern from
// household-tools.test.ts:1-35 / plan-tools.test.ts:1-28.
const h = vi.hoisted(() => ({
  loadEffectiveTree: vi.fn(),
  getOrComputeMaxSpending: vi.fn(),
  solveSsClaimAgeByPortfolio: vi.fn(),
  applyMutations: vi.fn((tree: unknown) => tree),
  runProjection: vi.fn(),
  runProjectionWithEvents: vi.fn(),
  explainChange: vi.fn(),
  explainComposition: vi.fn(),
  buildDrillContext: vi.fn(() => ({})),
  verifyClientAccessFor: vi.fn(),
}));

vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: h.loadEffectiveTree }));
// C3: solve_max_spending calls the canonical CACHED path — mock that, not
// getOrComputeMonteCarlo + solveMaxSpending (the brief's broken pairing).
vi.mock("@/lib/compute-cache/max-spending", () => ({ getOrComputeMaxSpending: h.getOrComputeMaxSpending }));
vi.mock("@/lib/solver/solve-ss-portfolio", () => ({ solveSsClaimAgeByPortfolio: h.solveSsClaimAgeByPortfolio }));
vi.mock("@/lib/solver/apply-mutations", () => ({ applyMutations: h.applyMutations }));
vi.mock("@/engine", () => ({ runProjection: h.runProjection, runProjectionWithEvents: h.runProjectionWithEvents }));
// SUBJECT_KEYS is ["tax"] — one registered adapter (not `as const`; see the
// registry itself, Object.keys(ADAPTERS) as SubjectKey[]).
vi.mock("@/lib/projection-explain/registry", () => ({ ADAPTERS: { tax: { key: "tax" } }, SUBJECT_KEYS: ["tax"] }));
vi.mock("@/lib/projection-explain/explain", () => ({
  explainChange: h.explainChange,
  explainComposition: h.explainComposition,
}));
vi.mock("@/lib/projection-explain/context", () => ({ buildDrillContext: h.buildDrillContext }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor: h.verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));

import { analysisTools } from "../tools/analysis";
import { ADAPTERS } from "@/lib/projection-explain/registry";
import { foundryUrl } from "@/lib/mcp/foundry-url";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = {
  userId: "u1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "sub_1",
};
const byName = (n: string) => analysisTools.find((t) => t.name === n)!;
const DENIED_MESSAGE = "Household not found or access denied";

const BASE_TREE = { client: {}, planSettings: {} };

/** Realistic ProjectionYear-shaped fixture (mirrors plan-tools.test.ts's
 *  makeYear()) — every leaf number distinct so a field swap is caught.
 *  portfolioAssets carries BOTH `total` (legacy — must never be read) and
 *  `liquidTotal` (canonical — must be read) with distinct values, so a
 *  regression back to `.total` (C5) is caught by comparing the two. */
function makeYear(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    year: 2030,
    taxResult: { flow: { totalTax: 91_000 } },
    portfolioAssets: { total: 3_160_000, liquidTotal: 2_460_000 },
    ...overrides,
  };
}

/** A realistic Explanation fixture (available branch) covering the keys this
 *  file's key-set pin (R60) exercises: the deltaExtras fields
 *  (taxLineDeltas/incomeDeltas/sourceDeltas/withdrawalPicture/
 *  marginalFederalRate) plus headline/causes/analysisContext/notes. It does
 *  NOT carry every key the real assembly can emit — the optional
 *  branch-only fields `noSignificantChange`, `degraded`, and
 *  `probableIntendedJump` are deliberately absent (separate branches, out of
 *  this fixture's scope; a prior version of this comment overstated that
 *  coverage — see F10, fix round 1). */
function makeExplanation() {
  return {
    available: true,
    subject: "tax",
    year: 2030,
    compareYear: 2029,
    headline: { figure: { label: "Total tax", from: 80_000, to: 91_000, delta: 11_000 } },
    causes: [{ kind: "rmd", summary: "RMD rose", incomeDelta: 10_000, evidence: {}, estimatedImpact: 2_400 }],
    analysisContext: {
      scenarioId: null as string | null,
      subject: "tax",
      boundaryAnalyzed: "2029→2030",
      planYearRange: { first: 2025, last: 2060 },
      materialityThreshold: 500,
    },
    notes: ["estimatedImpact values are approximations."],
    taxLineDeltas: [{ label: "Regular federal income tax", from: 50_000, to: 55_000, delta: 5_000 }],
    incomeDeltas: [{ label: "Earned income", from: 0, to: 0, delta: 0 }],
    sourceDeltas: [{ label: "IRA", from: 10_000, to: 20_000, delta: 10_000 }],
    withdrawalPicture: { byAccount: [], totalFundingPrev: 0, totalFundingNext: 0 },
    marginalFederalRate: { from: 0.24, to: 0.32 },
  };
}

/** A realistic, fully-populated Composition fixture (available, no level). */
function makeComposition() {
  return {
    available: true,
    subject: "tax",
    year: 2030,
    figure: 91_000,
    componentBreakdown: [{ label: "Regular federal income tax", amount: 55_000, type: "tax_line" }],
    analysisContext: {
      scenarioId: null as string | null,
      subject: "tax",
      boundaryAnalyzed: "2030",
      planYearRange: { first: 2025, last: 2060 },
      materialityThreshold: 500,
    },
    notes: ["componentBreakdown has two families…"],
  };
}

beforeEach(() => {
  h.loadEffectiveTree.mockReset().mockResolvedValue({
    effectiveTree: BASE_TREE,
    resolutionContext: { id: "rc1" },
  });
  h.getOrComputeMaxSpending.mockReset();
  h.solveSsClaimAgeByPortfolio.mockReset();
  h.applyMutations.mockReset().mockImplementation((tree: unknown) => tree);
  h.runProjection.mockReset();
  h.runProjectionWithEvents
    .mockReset()
    .mockReturnValue({ years: [makeYear()], firstDeathEvent: { year: 2045 }, secondDeathEvent: undefined });
  h.explainChange.mockReset().mockReturnValue({ available: false, reason: "outside the projection" });
  h.explainComposition.mockReset().mockReturnValue({ available: false, reason: "outside the projection" });
  h.buildDrillContext.mockReset().mockReturnValue({});
  h.verifyClientAccessFor
    .mockReset()
    .mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
});

describe("the tool set", () => {
  it("exposes exactly the five analysis tools, all read-only", () => {
    expect(analysisTools.map((t) => t.name).sort()).toEqual([
      "analyze_roth_conversion",
      "analyze_social_security",
      "break_down_projection_figure",
      "explain_projection_change",
      "solve_max_spending",
    ]);
    for (const t of analysisTools) {
      expect(t.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
  });

  it("every tool declares clientId exactly (never a plural clientIds) so the per-client authz gate always fires", () => {
    for (const t of analysisTools) {
      expect("clientId" in t.inputSchema.shape).toBe(true);
      expect("clientIds" in t.inputSchema.shape).toBe(false);
    }
  });

  it("every tool carries a real title and description", () => {
    for (const t of analysisTools) {
      expect(t.title).toMatch(/\S/);
      expect(t.description).toMatch(/\S/);
    }
  });
});

describe("explain_projection_change", () => {
  it("restricts subject to the tax adapter (C1)", () => {
    const schema = byName("explain_projection_change").inputSchema;
    expect(schema.safeParse({ clientId: "c", subject: "income", year: 2030 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030 }).success).toBe(true);
  });

  it("requires year and compareYear to be integers (F1/B3)", () => {
    const schema = byName("explain_projection_change").inputSchema;
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030.5 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030, compareYear: 2028.5 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030, compareYear: 2028 }).success).toBe(true);
  });

  it("pins the subject-restriction claim in the description, so a rewrite to 'any figure' can't slip past (F6)", () => {
    expect(byName("explain_projection_change").description).toContain("Only the 'tax' subject exists today");
  });

  it("looks up the tax adapter from the registry by bare index and passes it through, resolving scenario to 'base' when omitted", async () => {
    h.runProjectionWithEvents.mockReturnValue({
      years: [makeYear()],
      firstDeathEvent: { year: 2045 },
      secondDeathEvent: undefined,
    });
    await byName("explain_projection_change").run({ clientId: "c1", subject: "tax", year: 2030, compareYear: 2028 }, principal);
    expect(h.explainChange).toHaveBeenCalledWith({
      adapter: ADAPTERS.tax,
      years: [makeYear()],
      firstDeathYear: 2045,
      secondDeathYear: null,
      year: 2030,
      compareYear: 2028,
      ctx: {},
    });
    expect(h.loadEffectiveTree).toHaveBeenCalledWith("c1", "org_1", "base", {});
  });

  it("resolves firstDeathYear to null when no death event fired, mirroring secondDeathYear's null fallback (F7/S11)", async () => {
    h.runProjectionWithEvents.mockReturnValue({ years: [makeYear()], firstDeathEvent: undefined, secondDeathEvent: undefined });
    await byName("explain_projection_change").run({ clientId: "c1", subject: "tax", year: 2030 }, principal);
    expect(h.explainChange).toHaveBeenCalledWith({
      adapter: ADAPTERS.tax,
      years: [makeYear()],
      firstDeathYear: null,
      secondDeathYear: null,
      year: 2030,
      compareYear: undefined,
      ctx: {},
    });
  });

  it("fills analysisContext.scenarioId from context, since the pure adapter can't know it, AND echoes the same scenario at the top level (C2/F7-M13)", async () => {
    h.explainChange.mockReturnValue(makeExplanation());
    const out = (await byName("explain_projection_change").run(
      { clientId: "c1", scenarioId: "s1", subject: "tax", year: 2030 },
      principal,
    )) as Record<string, unknown>;
    const ctx = out.analysisContext as { scenarioId: string | null };
    expect(ctx.scenarioId).toBe("s1");
    expect(out.scenarioId).toBe("s1");
  });

  it("pins the exact top-level key set on the available branch, including foundryUrl (R60)", async () => {
    h.explainChange.mockReturnValue(makeExplanation());
    const out = (await byName("explain_projection_change").run(
      { clientId: "c1", scenarioId: "s1", subject: "tax", year: 2030 },
      principal,
    )) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      [
        "analysisContext",
        "available",
        "causes",
        "compareYear",
        "foundryUrl",
        "headline",
        "incomeDeltas",
        "marginalFederalRate",
        "notes",
        "scenarioId",
        "sourceDeltas",
        "subject",
        "taxLineDeltas",
        "withdrawalPicture",
        "year",
      ].sort(),
    );
    expect(out.foundryUrl).toBe(foundryUrl("c1", "tax"));
  });

  it("pins the exact top-level key set on the unavailable branch", async () => {
    h.explainChange.mockReturnValue({ available: false, reason: "Year 2099 is outside the projection (2025–2060)." });
    const out = (await byName("explain_projection_change").run(
      { clientId: "c1", subject: "tax", year: 2099 },
      principal,
    )) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["available", "foundryUrl", "reason", "scenarioId"].sort());
    expect(out.available).toBe(false);
  });

  it("rejects when the caller cannot access the household", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(
      byName("explain_projection_change").run({ clientId: "c1", subject: "tax", year: 2030 }, principal),
    ).rejects.toThrow(DENIED_MESSAGE);
    expect(h.explainChange).not.toHaveBeenCalled();
  });
});

describe("break_down_projection_figure", () => {
  it("restricts subject to the tax adapter, mirroring explain_projection_change", () => {
    const schema = byName("break_down_projection_figure").inputSchema;
    expect(schema.safeParse({ clientId: "c", subject: "income", year: 2030 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030 }).success).toBe(true);
  });

  it("requires year to be an integer, including the numeric compareTo branch (F1/B4)", () => {
    const schema = byName("break_down_projection_figure").inputSchema;
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030.5 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030, compareTo: 2028.5 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", subject: "tax", year: 2030, compareTo: 2028 }).success).toBe(true);
  });

  it("pins the subject-restriction claim in the description (F6)", () => {
    expect(byName("break_down_projection_figure").description).toContain("Only the 'tax' subject exists today");
  });

  it("defaults compareTo to 'none' when omitted", async () => {
    await byName("break_down_projection_figure").run({ clientId: "c1", subject: "tax", year: 2030 }, principal);
    expect(h.explainComposition).toHaveBeenCalledWith({
      adapter: ADAPTERS.tax,
      years: [makeYear()],
      year: 2030,
      compareTo: "none",
      ctx: {},
    });
  });

  it("passes a supplied compareTo straight through", async () => {
    await byName("break_down_projection_figure").run(
      { clientId: "c1", subject: "tax", year: 2030, compareTo: "prior_year" },
      principal,
    );
    expect(h.explainComposition).toHaveBeenCalledWith(expect.objectContaining({ compareTo: "prior_year" }));
  });

  it("passes a numeric compareTo (a specific year) straight through, not just the named references (F9)", async () => {
    await byName("break_down_projection_figure").run(
      { clientId: "c1", subject: "tax", year: 2030, compareTo: 2028 },
      principal,
    );
    expect(h.explainComposition).toHaveBeenCalledWith(expect.objectContaining({ compareTo: 2028 }));
  });

  it("fills analysisContext.scenarioId from context (C2)", async () => {
    h.explainComposition.mockReturnValue(makeComposition());
    const out = (await byName("break_down_projection_figure").run(
      { clientId: "c1", scenarioId: "s2", subject: "tax", year: 2030 },
      principal,
    )) as Record<string, unknown>;
    const ctx = out.analysisContext as { scenarioId: string | null };
    expect(ctx.scenarioId).toBe("s2");
  });

  it("pins the exact top-level key set on the available branch (R60)", async () => {
    h.explainComposition.mockReturnValue(makeComposition());
    const out = (await byName("break_down_projection_figure").run(
      { clientId: "c1", scenarioId: "s2", subject: "tax", year: 2030 },
      principal,
    )) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      ["analysisContext", "available", "componentBreakdown", "figure", "foundryUrl", "notes", "scenarioId", "subject", "year"].sort(),
    );
    expect(out.foundryUrl).toBe(foundryUrl("c1", "tax"));
  });

  it("pins the exact top-level key set on the unavailable branch too, mirroring explain_projection_change (F9)", async () => {
    h.explainComposition.mockReturnValue({ available: false, reason: "Year 2099 is outside the projection (2025–2060)." });
    const out = (await byName("break_down_projection_figure").run(
      { clientId: "c1", subject: "tax", year: 2099 },
      principal,
    )) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["available", "foundryUrl", "reason", "scenarioId"].sort());
    expect(out.available).toBe(false);
  });

  it("rejects when the caller cannot access the household", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(
      byName("break_down_projection_figure").run({ clientId: "c1", subject: "tax", year: 2030 }, principal),
    ).rejects.toThrow(DENIED_MESSAGE);
    expect(h.explainComposition).not.toHaveBeenCalled();
  });
});

describe("solve_max_spending", () => {
  it("rejects a target probability outside the solver's range", () => {
    const schema = byName("solve_max_spending").inputSchema;
    expect(schema.safeParse({ clientId: "c", targetPoS: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", targetPoS: 0.85 }).success).toBe(true);
  });

  it("pins the stated bounds exactly — 0 and 1 are both out of range, only [0.01, 0.99] is in (F1/B1/B2)", () => {
    const schema = byName("solve_max_spending").inputSchema;
    expect(schema.safeParse({ clientId: "c", targetPoS: 0 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", targetPoS: 1 }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", targetPoS: 0.01 }).success).toBe(true);
    expect(schema.safeParse({ clientId: "c", targetPoS: 0.99 }).success).toBe(true);
  });

  it("calls the canonical cached solver with clientId/firmId/scenarioId/targetPoS, never hand-assembling loadEffectiveTree + a raw MC payload (C3)", async () => {
    h.getOrComputeMaxSpending.mockResolvedValue({
      realAnnualSpend: 142_000,
      scaleFactor: 1.1,
      achievedPoS: 0.85,
      status: "converged",
    });
    await byName("solve_max_spending").run({ clientId: "c1", scenarioId: "s1", targetPoS: 0.85 }, principal);
    expect(h.getOrComputeMaxSpending).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "org_1",
      scenarioId: "s1",
      targetPoS: 0.85,
    });
    // The old (broken) pairing loaded the tree and ran a projection directly
    // in this tool; the cached path owns all of that internally.
    expect(h.loadEffectiveTree).not.toHaveBeenCalled();
    expect(h.runProjection).not.toHaveBeenCalled();
  });

  it("resolves scenario to 'base' when omitted and returns the solved spend and probability achieved", async () => {
    h.getOrComputeMaxSpending.mockResolvedValue({
      realAnnualSpend: 142_000,
      scaleFactor: 1.1,
      achievedPoS: 0.85,
      status: "converged",
    });
    const out = (await byName("solve_max_spending").run({ clientId: "c1", targetPoS: 0.85 }, principal)) as Record<
      string,
      unknown
    >;
    expect(h.getOrComputeMaxSpending).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "org_1",
      scenarioId: "base",
      targetPoS: 0.85,
    });
    expect(out.scenarioId).toBe("base");
    expect(out.realAnnualSpend).toBe(142_000);
    expect(out.achievedPoS).toBe(0.85);
    expect(out.status).toBe("converged");
  });

  it("passes a SECOND, distinct targetPoS (0.95) into the solver call and echoes that same value in the payload, not the 0.85 used elsewhere (F1/M8/M9)", async () => {
    h.getOrComputeMaxSpending.mockResolvedValue({
      realAnnualSpend: 200_000,
      scaleFactor: 1.4,
      achievedPoS: 0.95,
      status: "converged",
    });
    const out = (await byName("solve_max_spending").run({ clientId: "c1", targetPoS: 0.95 }, principal)) as Record<
      string,
      unknown
    >;
    expect(h.getOrComputeMaxSpending).toHaveBeenCalledWith({
      clientId: "c1",
      firmId: "org_1",
      scenarioId: "base",
      targetPoS: 0.95,
    });
    expect(out.targetPoS).toBe(0.95);
  });

  it("pins the exact top-level key set (R60), including the exact deep link (F5)", async () => {
    h.getOrComputeMaxSpending.mockResolvedValue({
      realAnnualSpend: 142_000,
      scaleFactor: 1.1,
      achievedPoS: 0.85,
      status: "converged",
    });
    const out = (await byName("solve_max_spending").run({ clientId: "c1", targetPoS: 0.85 }, principal)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out).sort()).toEqual(
      ["achievedPoS", "foundryUrl", "realAnnualSpend", "scaleFactor", "scenarioId", "status", "targetPoS"].sort(),
    );
    expect(out.foundryUrl).toBe(foundryUrl("c1", "monteCarlo"));
  });

  it("rejects when the caller cannot access the household", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(
      byName("solve_max_spending").run({ clientId: "c1", targetPoS: 0.85 }, principal),
    ).rejects.toThrow(DENIED_MESSAGE);
    expect(h.getOrComputeMaxSpending).not.toHaveBeenCalled();
  });
});

describe("analyze_roth_conversion", () => {
  it("rejects an empty conversions array and a non-positive amount", () => {
    const schema = byName("analyze_roth_conversion").inputSchema;
    expect(
      schema.safeParse({ clientId: "c", conversions: [] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        clientId: "c",
        conversions: [{ id: "r1", year: 2030, amount: 0, sourceAccountId: "a", destinationAccountId: "b" }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        clientId: "c",
        conversions: [{ id: "r1", year: 2030, amount: 50_000, sourceAccountId: "a", destinationAccountId: "b" }],
      }).success,
    ).toBe(true);
  });

  it("requires each conversion's year to be an integer (F1/B4)", () => {
    const schema = byName("analyze_roth_conversion").inputSchema;
    expect(
      schema.safeParse({
        clientId: "c",
        conversions: [{ id: "r1", year: 2030.5, amount: 50_000, sourceAccountId: "a", destinationAccountId: "b" }],
      }).success,
    ).toBe(false);
  });

  it("discloses the single-year fixed-dollar shape and the aggregate-only attribution guard in the description (F4)", () => {
    const description = byName("analyze_roth_conversion").description;
    expect(description).toContain("single-year, fixed-dollar conversion");
    expect(description).toContain("do not attribute a dollar amount to any single conversion");
  });

  it("pins the liquid-portfolio disclosure in the description (F6)", () => {
    expect(byName("analyze_roth_conversion").description).toContain(
      "it excludes home/real estate, business, stock options, and locked trust assets.",
    );
  });

  it("builds ONE roth-conversion-upsert mutation PER conversion, each carrying a full RothConversion value with an array sourceAccountIds (C4)", async () => {
    h.runProjection.mockReturnValueOnce([makeYear()]).mockReturnValueOnce([makeYear()]);
    await byName("analyze_roth_conversion").run(
      {
        clientId: "c1",
        scenarioId: "s1",
        conversions: [
          { id: "rc1", name: "Drain the IRA", year: 2031, amount: 50_000, sourceAccountId: "acct-ira", destinationAccountId: "acct-roth" },
          { id: "rc2", year: 2032, amount: 20_000, sourceAccountId: "acct-ira-2", destinationAccountId: "acct-roth" },
        ],
      },
      principal,
    );
    expect(h.applyMutations).toHaveBeenCalledWith(BASE_TREE, [
      {
        kind: "roth-conversion-upsert",
        id: "rc1",
        value: {
          id: "rc1",
          name: "Drain the IRA",
          destinationAccountId: "acct-roth",
          sourceAccountIds: ["acct-ira"],
          conversionType: "fixed_amount",
          fixedAmount: 50_000,
          startYear: 2031,
          endYear: 2031,
          indexingRate: 0,
        },
      },
      {
        kind: "roth-conversion-upsert",
        id: "rc2",
        value: {
          id: "rc2",
          name: "Roth conversion 2032",
          destinationAccountId: "acct-roth",
          sourceAccountIds: ["acct-ira-2"],
          conversionType: "fixed_amount",
          fixedAmount: 20_000,
          startYear: 2032,
          endYear: 2032,
          indexingRate: 0,
        },
      },
    ]);
  });

  it("reads endingPortfolio from portfolioAssets.liquidTotal, never the legacy .total (C5)", async () => {
    h.runProjection
      .mockReturnValueOnce([makeYear({ portfolioAssets: { total: 9_000_000, liquidTotal: 500_000 } })])
      .mockReturnValueOnce([makeYear({ portfolioAssets: { total: 1_000, liquidTotal: 800_000 } })]);
    const out = (await byName("analyze_roth_conversion").run(
      {
        clientId: "c1",
        conversions: [{ id: "rc1", year: 2031, amount: 50_000, sourceAccountId: "a", destinationAccountId: "b" }],
      },
      principal,
    )) as { baseline: { endingPortfolio: number }; withConversions: { endingPortfolio: number } };
    expect(out.baseline.endingPortfolio).toBe(500_000);
    expect(out.withConversions.endingPortfolio).toBe(800_000);
  });

  it("sums lifetimeTax across years, defaulting a year with no taxResult to 0, and computes a SIGNED endingPortfolioDelta that a sign flip would catch (F2)", async () => {
    // baseline and withConversions end at DIFFERENT liquidTotal values (round
    // 1's fixture had both end at 2,460,000, making `a-b`, `b-a` and a
    // literal 0 all pass — M11). Distinct, non-zero-delta endings here mean
    // swapping the subtraction's operand order reddens this assertion.
    h.runProjection
      .mockReturnValueOnce([
        makeYear({ year: 2030, taxResult: { flow: { totalTax: 10_000 } }, portfolioAssets: { total: 1, liquidTotal: 1_000_000 } }),
        makeYear({ year: 2031, taxResult: undefined, portfolioAssets: { total: 1, liquidTotal: 1_010_000 } }),
        makeYear({ year: 2032, taxResult: { flow: { totalTax: 20_000 } }, portfolioAssets: { total: 1, liquidTotal: 1_020_000 } }),
      ])
      .mockReturnValueOnce([
        makeYear({ year: 2030, taxResult: { flow: { totalTax: 15_000 } }, portfolioAssets: { total: 1, liquidTotal: 900_000 } }),
      ]);
    const out = (await byName("analyze_roth_conversion").run(
      {
        clientId: "c1",
        conversions: [{ id: "rc1", year: 2031, amount: 50_000, sourceAccountId: "a", destinationAccountId: "b" }],
      },
      principal,
    )) as Record<string, unknown>;
    expect(out.baseline).toEqual({ lifetimeTax: 30_000, endingPortfolio: 1_020_000 });
    expect(out.withConversions).toEqual({ lifetimeTax: 15_000, endingPortfolio: 900_000 });
    expect(out.lifetimeTaxDelta).toBe(-15_000);
    expect(out.endingPortfolioDelta).toBe(-120_000);
  });

  it("defaults endingPortfolio (and lifetimeTax) to 0 when a projection returns no years at all, guarding against NaN/undefined in production (F7/M12)", async () => {
    h.runProjection.mockReturnValueOnce([]).mockReturnValueOnce([makeYear()]);
    const out = (await byName("analyze_roth_conversion").run(
      {
        clientId: "c1",
        conversions: [{ id: "rc1", year: 2031, amount: 50_000, sourceAccountId: "a", destinationAccountId: "b" }],
      },
      principal,
    )) as { baseline: { endingPortfolio: number; lifetimeTax: number } };
    expect(out.baseline).toEqual({ lifetimeTax: 0, endingPortfolio: 0 });
  });

  it("pins the exact top-level key set (R60)", async () => {
    h.runProjection.mockReturnValueOnce([makeYear()]).mockReturnValueOnce([makeYear()]);
    const out = (await byName("analyze_roth_conversion").run(
      {
        clientId: "c1",
        conversions: [{ id: "rc1", year: 2031, amount: 50_000, sourceAccountId: "a", destinationAccountId: "b" }],
      },
      principal,
    )) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      ["baseline", "endingPortfolioDelta", "foundryUrl", "lifetimeTaxDelta", "note", "scenarioId", "withConversions"].sort(),
    );
    expect(out.note).toBe("Modeled only — nothing was saved to the household's plan.");
    expect(out.foundryUrl).toBe(foundryUrl("c1", "tax"));
  });

  it("rejects when the caller cannot access the household", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(
      byName("analyze_roth_conversion").run(
        { clientId: "c1", conversions: [{ id: "rc1", year: 2031, amount: 50_000, sourceAccountId: "a", destinationAccountId: "b" }] },
        principal,
      ),
    ).rejects.toThrow(DENIED_MESSAGE);
    expect(h.applyMutations).not.toHaveBeenCalled();
  });
});

describe("analyze_social_security", () => {
  it("only accepts 'client' or 'spouse'", () => {
    const schema = byName("analyze_social_security").inputSchema;
    expect(schema.safeParse({ clientId: "c", person: "child" }).success).toBe(false);
    expect(schema.safeParse({ clientId: "c", person: "spouse" }).success).toBe(true);
  });

  it("passes resolutionContext and an empty baselineMutations through to the deterministic solver", async () => {
    h.solveSsClaimAgeByPortfolio.mockReturnValue({
      objective: "ending-portfolio",
      status: "converged",
      solvedValue: 67,
      endingPortfolio: 900_000,
      candidates: [{ value: 62, endingPortfolio: 800_000 }],
      finalProjection: [makeYear()],
    });
    await byName("analyze_social_security").run({ clientId: "c1", scenarioId: "s1", person: "client" }, principal);
    expect(h.solveSsClaimAgeByPortfolio).toHaveBeenCalledWith({
      effectiveTree: BASE_TREE,
      baselineMutations: [],
      person: "client",
      resolutionContext: { id: "rc1" },
    });
  });

  it("passes a SECOND, distinct person ('spouse') into the solver call and echoes that same value in the payload, not the 'client' used elsewhere (F1/X1/X2)", async () => {
    h.solveSsClaimAgeByPortfolio.mockReturnValue({
      objective: "ending-portfolio",
      status: "converged",
      solvedValue: 64,
      endingPortfolio: 750_000,
      candidates: [{ value: 64, endingPortfolio: 750_000 }],
      finalProjection: [makeYear()],
    });
    const out = (await byName("analyze_social_security").run({ clientId: "c1", person: "spouse" }, principal)) as Record<
      string,
      unknown
    >;
    expect(h.solveSsClaimAgeByPortfolio).toHaveBeenCalledWith({
      effectiveTree: BASE_TREE,
      baselineMutations: [],
      person: "spouse",
      resolutionContext: { id: "rc1" },
    });
    expect(out.person).toBe("spouse");
  });

  it("renames candidates[].value to claimAge, never leaving a bare 'value' key (C6)", async () => {
    h.solveSsClaimAgeByPortfolio.mockReturnValue({
      objective: "ending-portfolio",
      status: "converged",
      solvedValue: 67,
      endingPortfolio: 900_000,
      candidates: [
        { value: 62, endingPortfolio: 800_000 },
        { value: 67, endingPortfolio: 900_000 },
      ],
      finalProjection: [makeYear()],
    });
    const out = (await byName("analyze_social_security").run({ clientId: "c1", person: "client" }, principal)) as {
      candidates: Array<Record<string, unknown>>;
    };
    expect(out.candidates).toEqual([
      { claimAge: 62, endingPortfolio: 800_000 },
      { claimAge: 67, endingPortfolio: 900_000 },
    ]);
    for (const row of out.candidates) expect(row).not.toHaveProperty("value");
  });

  it("pins the exact top-level key set, proving finalProjection (a whole ProjectionYear[]) never leaves the server (C6)", async () => {
    h.solveSsClaimAgeByPortfolio.mockReturnValue({
      objective: "ending-portfolio",
      status: "converged",
      solvedValue: 67,
      endingPortfolio: 900_000,
      candidates: [{ value: 67, endingPortfolio: 900_000 }],
      finalProjection: [makeYear()],
    });
    const out = (await byName("analyze_social_security").run({ clientId: "c1", person: "spouse" }, principal)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(out).sort()).toEqual(
      ["candidates", "endingPortfolio", "foundryUrl", "note", "person", "scenarioId", "solvedClaimAge", "status"].sort(),
    );
    expect(out.solvedClaimAge).toBe(67);
    // F3: value-assert the dollar figure itself, distinct from solvedValue
    // (67, an age) — swapping solved.endingPortfolio for solved.solvedValue
    // in the handler would otherwise pass every case here undetected, since
    // the key-set pin only sees the KEY "endingPortfolio", never its value.
    expect(out.endingPortfolio).toBe(900_000);
    expect(out.note).toBe("Modeled only — nothing was saved to the household's plan.");
    expect(out.foundryUrl).toBe(foundryUrl("c1", "cashflow"));
  });

  it("pins the final-year liquid-portfolio disclosure in the description (F6)", () => {
    expect(byName("analyze_social_security").description).toContain(
      "it excludes home/real estate, business, stock options, and locked trust assets.",
    );
  });

  it("rejects when the caller cannot access the household", async () => {
    h.verifyClientAccessFor.mockResolvedValue({ ok: false, permission: "view", firmId: "org_1", access: "none" });
    await expect(
      byName("analyze_social_security").run({ clientId: "c1", person: "client" }, principal),
    ).rejects.toThrow(DENIED_MESSAGE);
    expect(h.solveSsClaimAgeByPortfolio).not.toHaveBeenCalled();
  });
});
