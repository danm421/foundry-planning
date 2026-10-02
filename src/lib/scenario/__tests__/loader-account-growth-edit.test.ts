// src/lib/scenario/__tests__/loader-account-growth-edit.test.ts
//
// An account EDIT is applied field by field onto the already-RESOLVED account,
// so a growth-input edit (a growth source, a portfolio, a rate) never reached the
// resolved `growthRate` the engine reads: "clear custom growth" kept the old
// custom rate, and the account form's `growthRate: null` zeroed growth. The
// scenario overlay re-resolves those accounts the way an add is resolved.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/projection/resolve-entity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/projection/resolve-entity")>();
  return { ...actual, resolveAccountFromRaw: vi.fn(actual.resolveAccountFromRaw) };
});

import { applyScenarioChangesWithRefs, resolveAddPayload } from "../loader";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { createGrowthSourceResolver } from "@/lib/projection/resolve-growth-source";
import { resolveAccountFromRaw, type ResolutionContext } from "@/lib/projection/resolve-entity";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";
import type { Account, ClientData } from "@/engine/types";

function makeCtx(accountRawGrowthById?: ResolutionContext["accountRawGrowthById"]): ResolutionContext {
  const resolver = createGrowthSourceResolver({
    planSettings: {
      growthSourceTaxable: "default",
      growthSourceCash: "default",
      growthSourceRetirement: "default",
      growthSourceRealEstate: "default",
      growthSourceBusiness: "default",
      growthSourceLifeInsurance: "default",
      modelPortfolioIdTaxable: null,
      modelPortfolioIdCash: null,
      modelPortfolioIdRetirement: null,
      defaultGrowthTaxable: "0.07",
      defaultGrowthCash: "0.02",
      defaultGrowthRetirement: "0.06",
      defaultGrowthRealEstate: "0.04",
      defaultGrowthBusiness: "0.05",
      defaultGrowthLifeInsurance: "0.03",
      inflationAssetClassId: null,
    },
    // mp-1: 8%, all ordinary income. mp-2 and ticker tp-1: 6%, all long-term gains.
    assetClasses: [
      {
        id: "ac-1",
        geometricReturn: "0.08",
        pctOrdinaryIncome: "1",
        pctLtCapitalGains: "0",
        pctQualifiedDividends: "0",
        pctTaxExempt: "0",
      },
      {
        id: "ac-2",
        geometricReturn: "0.06",
        pctOrdinaryIncome: "0",
        pctLtCapitalGains: "1",
        pctQualifiedDividends: "0",
        pctTaxExempt: "0",
      },
    ],
    modelPortfolios: [{ id: "mp-1" }, { id: "mp-2" }],
    modelPortfolioAllocations: [
      { portfolioId: "mp-1", assetClassId: "ac-1", weight: "1" },
      { portfolioId: "mp-2", assetClassId: "ac-2", weight: "1" },
    ],
    tickerPortfolioAllocations: [{ tickerPortfolioId: "tp-1", assetClassId: "ac-2", weight: "1" }],
    accountAssetAllocations: [],
    clientCmaOverrides: [],
  });
  return { resolver, resolvedInflationRate: 0.025, ownersByAccountId: new Map(), accountRawGrowthById };
}

/** Base accounts as `loadClientData` resolves them: a custom 9% brokerage and a
 *  custom 11% business. */
function tree(): ClientData {
  const base: Partial<Account> = {
    value: 100_000,
    basis: 100_000,
    owners: [],
    rmdEnabled: false,
    isDefaultChecking: false,
    annualPropertyTax: 0,
    propertyTaxGrowthRate: 0,
    modelPortfolioId: null,
  };
  return {
    client: { dateOfBirth: "1970-06-15", retirementAge: 65, planEndAge: 95, filingStatus: "single" },
    planSettings: { planStartYear: 2025, planEndYear: 2065 },
    accounts: [
      { ...base, id: "brk", name: "Brokerage", category: "taxable", subType: "individual", growthSource: "custom", growthRate: 0.09 },
      { ...base, id: "biz", name: "Acme LLC", category: "business", subType: "llc", growthSource: "custom", growthRate: 0.11 },
    ],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
  } as unknown as ClientData;
}

const change = (over: Partial<ScenarioChange>): ScenarioChange => ({
  id: "ch-1",
  scenarioId: "scn-1",
  opType: "edit",
  targetKind: "account",
  targetId: "brk",
  payload: {},
  toggleGroupId: null,
  orderIndex: 0,
  ...over,
});

/** The account form's edit when the advisor flips Custom 9% back to the default. */
const clearBrokerageGrowth = change({
  payload: {
    growthSource: { from: "custom", to: "default" },
    growthRate: { from: 0.09, to: null },
  },
});

/** The business dialog's edit when the advisor clears a custom rate. */
const clearBusinessGrowth = change({
  targetId: "biz",
  payload: {
    growthSource: { from: "custom", to: "default" },
    growthRate: { from: 0.11, to: null },
  },
});

const account = (t: ClientData, id: string) => t.accounts.find((a) => a.id === id)!;

// Braces matter: a function returned from beforeEach runs as a cleanup hook.
beforeEach(() => {
  vi.mocked(resolveAccountFromRaw).mockClear();
});

describe("applyScenarioChangesWithRefs — an account edit of a growth input re-resolves", () => {
  it("a custom → default flip lands on the category default, not the old rate and not null", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(tree(), [clearBrokerageGrowth], {}, [], makeCtx());
    const brk = account(effectiveTree, "brk");
    expect(brk.growthRate).toBeCloseTo(0.07);
    expect(brk.realization).toEqual(makeCtx().resolver.resolveCategoryDefault("taxable").realization);
  });

  it("a switch to a model portfolio takes the portfolio's rate and realization", () => {
    const edit = change({
      payload: {
        growthSource: { from: "custom", to: "model_portfolio" },
        modelPortfolioId: { from: null, to: "mp-1" },
        growthRate: { from: 0.09, to: null },
      },
    });
    const { effectiveTree } = applyScenarioChangesWithRefs(tree(), [edit], {}, [], makeCtx());
    const brk = account(effectiveTree, "brk");
    expect(brk.growthRate).toBeCloseTo(0.08);
    expect(brk.realization?.pctOrdinaryIncome).toBe(1);
  });

  it("a business's cleared custom rate lands on the business default", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(tree(), [clearBusinessGrowth], {}, [], makeCtx());
    expect(account(effectiveTree, "biz").growthRate).toBeCloseTo(0.05);
  });

  it("a scenario-ADDED business whose rate was cleared resolves to the business default", () => {
    // The changes writer folds the dialog's clear into the add row's payload.
    const ctx = makeCtx();
    const add = change({
      id: "ch-add",
      opType: "add",
      targetId: "biz-new",
      payload: {
        id: "biz-new",
        name: "New Co",
        category: "business",
        subType: "llc",
        value: 50_000,
        basis: 50_000,
        owners: [],
        ...{ growthSource: "custom", growthRate: 0.11 },
        ...{ growthSource: "default", growthRate: null },
      },
    });
    const { effectiveTree } = applyScenarioChangesWithRefs(tree(), [resolveAddPayload(add, ctx)], {}, [], ctx);
    expect(account(effectiveTree, "biz-new").growthRate).toBeCloseTo(0.05);
  });

  it("a growth edit in a switched-off toggle group has no effect and resolves nothing", () => {
    const off: ToggleGroup = {
      id: "g-off",
      scenarioId: "scn-1",
      name: "Off",
      defaultOn: false,
      requiresGroupId: null,
      orderIndex: 0,
    };
    const { effectiveTree } = applyScenarioChangesWithRefs(
      tree(),
      [{ ...clearBrokerageGrowth, toggleGroupId: "g-off" }],
      {},
      [off],
      makeCtx(),
    );
    expect(account(effectiveTree, "brk")).toEqual(account(tree(), "brk"));
    expect(resolveAccountFromRaw).not.toHaveBeenCalled();
  });

  it("a scenario with no growth edits resolves nothing and builds the same accounts as before", () => {
    const valueEdit = change({ payload: { value: { from: 100_000, to: 150_000 } } });
    const { effectiveTree } = applyScenarioChangesWithRefs(tree(), [valueEdit], {}, [], makeCtx());
    expect(resolveAccountFromRaw).not.toHaveBeenCalled();
    expect(effectiveTree.accounts).toEqual(applyScenarioChanges(tree(), [valueEdit], {}, []).effectiveTree.accounts);
  });
});

describe("applyScenarioChangesWithRefs — a PARTIAL growth edit keeps the stored inputs the engine account drops", () => {
  // The engine account carries no ticker portfolio, turnover, realization
  // overrides or property-tax source, so a writer that sends only what changed
  // (Forge's `propose_changes`) must not lose them on re-resolve.
  type Raw = Parameters<typeof resolveAccountFromRaw>[0];
  const raw = (over: Partial<Raw> & Pick<Raw, "id" | "category" | "growthSource">): Raw => ({
    name: over.id,
    subType: "individual",
    value: 100_000,
    basis: 100_000,
    growthRate: null,
    turnoverPct: null,
    annualPropertyTax: 0,
    propertyTaxGrowthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: false,
    modelPortfolioId: null,
    tickerPortfolioId: null,
    overridePctOi: null,
    overridePctLtCg: null,
    overridePctQdiv: null,
    overridePctTaxExempt: null,
    priorYearEndValue: null,
    insuredPerson: null,
    titlingType: "jtwros",
    owners: [],
    ...over,
  });
  // Stored turnover 25% and a 40% ordinary-income override on each.
  const stored = { turnoverPct: "0.25", overridePctOi: "0.4" };
  const ROWS = [
    raw({ id: "tkr", category: "taxable", growthSource: "ticker_portfolio", tickerPortfolioId: "tp-1", ...stored }),
    raw({ id: "mpa", category: "taxable", growthSource: "model_portfolio", modelPortfolioId: "mp-1", ...stored }),
    raw({ id: "cst", category: "taxable", growthSource: "custom", growthRate: "0.09", modelPortfolioId: "mp-1", ...stored }),
    raw({
      id: "home",
      category: "real_estate",
      subType: "primary_residence",
      growthSource: "custom",
      growthRate: "0.04",
      annualPropertyTax: 12_000,
      propertyTaxGrowthRate: "0.03",
      propertyTaxGrowthSource: "inflation",
    }),
  ];

  /** The base tree and context `loadClientData` builds from those rows. */
  function base() {
    const ctx = makeCtx(
      new Map(
        ROWS.map((r) => [
          r.id,
          {
            tickerPortfolioId: r.tickerPortfolioId,
            turnoverPct: r.turnoverPct,
            overridePctOi: r.overridePctOi,
            overridePctLtCg: r.overridePctLtCg,
            overridePctQdiv: r.overridePctQdiv,
            overridePctTaxExempt: r.overridePctTaxExempt,
            propertyTaxGrowthSource: r.propertyTaxGrowthSource ?? null,
          },
        ]),
      ),
    );
    return { ctx, tree: { ...tree(), accounts: ROWS.map((r) => resolveAccountFromRaw(r, ctx)) } as ClientData };
  }
  const run = (targetId: string, payload: Record<string, { from: unknown; to: unknown }>) => {
    const { ctx, tree: t } = base();
    const before = account(t, targetId);
    const after = account(applyScenarioChangesWithRefs(t, [change({ targetId, payload })], {}, [], ctx).effectiveTree, targetId);
    return { before, after };
  };

  it("a turnover-only edit of a ticker account keeps its ticker rate and realization", () => {
    const { before, after } = run("tkr", { turnoverPct: { from: undefined, to: "0.5" } });
    expect(before.growthRate).toBeCloseTo(0.06); // the control: tp-1, not the 7% default
    expect(after.growthRate).toBeCloseTo(0.06);
    expect(after.realization).toEqual({ ...before.realization, turnoverPct: 0.5 });
  });

  it("a growth-source-only edit keeps the stored turnover and overrides", () => {
    const { after } = run("cst", { growthSource: { from: "custom", to: "model_portfolio" } });
    expect(after.growthRate).toBeCloseTo(0.08);
    expect(after.realization).toMatchObject({ pctOrdinaryIncome: 0.4, turnoverPct: 0.25 });
  });

  it("a portfolio-only edit keeps the stored turnover and overrides", () => {
    const { after } = run("mpa", { modelPortfolioId: { from: "mp-1", to: "mp-2" } });
    expect(after.growthRate).toBeCloseTo(0.06);
    expect(after.realization).toEqual({
      pctOrdinaryIncome: 0.4,
      pctLtCapitalGains: 1,
      pctQualifiedDividends: 0,
      pctTaxExempt: 0,
      turnoverPct: 0.25,
    });
  });

  it("a property-tax-rate-only edit keeps an inflation-linked property tax on inflation", () => {
    const { before, after } = run("home", { propertyTaxGrowthRate: { from: 0.025, to: "0.05" } });
    expect(before.propertyTaxGrowthRate).toBeCloseTo(0.025);
    expect(after.propertyTaxGrowthRate).toBeCloseTo(0.025);
  });

  it("the account form's full key set resolves exactly as it says", () => {
    const { after } = run("mpa", {
      modelPortfolioId: { from: "mp-1", to: "mp-2" },
      growthRate: { from: 0.08, to: null },
      turnoverPct: { from: undefined, to: "0.1" },
      overridePctOi: { from: undefined, to: "0.3" },
    });
    expect(after.growthRate).toBeCloseTo(0.06);
    expect(after.realization).toMatchObject({ pctOrdinaryIncome: 0.3, pctLtCapitalGains: 1, turnoverPct: 0.1 });
  });
});
