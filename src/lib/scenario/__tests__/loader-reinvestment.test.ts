// src/lib/scenario/__tests__/loader-reinvestment.test.ts
//
// Regression test for the "reinvestment broken in non-base scenarios" bug.
//
// The engine `Reinvestment` type carries RESOLVED fields (newGrowthRate,
// newRealization, soldFractionByAccount). The scenario overlay merges the RAW
// form payload (modelPortfolioId / customGrowthRate / customPct*) without
// resolving it. Before the fix, a scenario-ADDED reinvestment reached
// `applyReinvestments` with no resolved fields → `acct.growthRate = undefined`
// and a TypeError on `soldFractionByAccount[acct.id]` for a taxed switch.
//
// `applyScenarioChangesWithRefs` must re-run `resolveReinvestments` over the
// effective tree's reinvestments so added / edited / unchanged reinvestments
// all carry correct resolved fields.

import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import { createGrowthSourceResolver } from "@/lib/projection/resolve-growth-source";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import type { ClientData, Reinvestment } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { AllocationMap } from "@/lib/projection/reinvestment-sold-fraction";
import { expandReinvestmentTargets } from "@/lib/projection/expand-reinvestment-targets";
import { resolveReinvestments } from "@/lib/projection/resolve-reinvestments";
import type { AccountCategory } from "@/lib/account-groups/liquid-filter";

const assetClasses = [
  {
    id: "us-eq",
    geometricReturn: "0.08",
    pctOrdinaryIncome: "0.0",
    pctLtCapitalGains: "0.8",
    pctQualifiedDividends: "0.2",
    pctTaxExempt: "0.0",
  },
  {
    id: "bond",
    geometricReturn: "0.03",
    pctOrdinaryIncome: "1.0",
    pctLtCapitalGains: "0.0",
    pctQualifiedDividends: "0.0",
    pctTaxExempt: "0.0",
  },
  {
    id: "inflation",
    geometricReturn: "0.025",
    pctOrdinaryIncome: "0",
    pctLtCapitalGains: "0",
    pctQualifiedDividends: "0",
    pctTaxExempt: "0",
  },
] as const;

const planSettings = {
  growthSourceTaxable: "model_portfolio",
  modelPortfolioIdTaxable: "mp-aggressive",
  defaultGrowthTaxable: "0.05",
  growthSourceCash: "inflation",
  modelPortfolioIdCash: null,
  defaultGrowthCash: "0.02",
  growthSourceRetirement: "category_default",
  modelPortfolioIdRetirement: null,
  defaultGrowthRetirement: "0.06",
  defaultGrowthRealEstate: "0.04",
  defaultGrowthBusiness: "0.08",
  defaultGrowthLifeInsurance: "0.03",
  inflationAssetClassId: "inflation",
} as unknown as Parameters<typeof createGrowthSourceResolver>[0]["planSettings"];

function makeResolutionContext(): ResolutionContext {
  const resolver = createGrowthSourceResolver({
    planSettings,
    assetClasses,
    modelPortfolios: [{ id: "mp-aggressive" }, { id: "mp-conservative" }],
    modelPortfolioAllocations: [
      { portfolioId: "mp-aggressive", assetClassId: "us-eq", weight: "1.0" },
      { portfolioId: "mp-conservative", assetClassId: "us-eq", weight: "0.2" },
      { portfolioId: "mp-conservative", assetClassId: "bond", weight: "0.8" },
    ],
    accountAssetAllocations: [],
    clientCmaOverrides: [],
  });
  // The brokerage account is 100% equity before any reinvestment.
  const accountBaseAllocByAccountId = new Map<string, AllocationMap | undefined>([
    ["a-brokerage", new Map([["us-eq", 1.0]])],
  ]);
  return {
    resolver,
    resolvedInflationRate: 0.025,
    beneficiariesByAccountId: new Map(),
    policiesByAccount: {},
    ownersByAccountId: new Map(),
    accountBaseAllocByAccountId,
  };
}

function baseTree(): ClientData {
  return {
    client: { id: "c1", dateOfBirth: "1970-06-15", retirementAge: 60, planEndAge: 95 },
    planSettings: { planStartYear: 2025, planEndYear: 2065 },
    accounts: [{ id: "a-brokerage", category: "taxable" }],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
    reinvestments: [],
  } as unknown as ClientData;
}

/** A scenario `add` change carrying a RAW reinvestment payload — the shape the
 *  reinvestment form persists (`entity: {id, ...body}`). */
function addReinvestmentChange(): ScenarioChange {
  const rawPayload = {
    id: "ri-scenario",
    name: "Switch to Conservative 2035",
    accountIds: ["a-brokerage"],
    year: 2035,
    realizeTaxesOnSwitch: true,
    yearRef: null,
    targetType: "model_portfolio",
    modelPortfolioId: "mp-conservative",
    customGrowthRate: null,
    customPctOrdinaryIncome: null,
    customPctLtCapitalGains: null,
    customPctQualifiedDividends: null,
    customPctTaxExempt: null,
    // Resolved placeholders — the raw form payload would not even include
    // these; applyChanges merges whatever the writer stored.
    newGrowthRate: 0,
    soldFractionByAccount: {},
  };
  return {
    id: "ch1",
    scenarioId: "scn1",
    opType: "add",
    targetKind: "reinvestment",
    targetId: "ri-scenario",
    payload: rawPayload,
    toggleGroupId: null,
    orderIndex: 0,
  };
}

describe("applyScenarioChangesWithRefs — reinvestment re-resolution", () => {
  it("documents the gap: applyScenarioChanges alone leaves a scenario-added reinvestment unresolved", () => {
    // Without a resolutionContext, the reinvestment keeps its raw placeholder
    // resolved fields — newGrowthRate stays 0, soldFractionByAccount empty.
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [addReinvestmentChange()],
      {},
      [],
    );
    const ri = effectiveTree.reinvestments![0];
    expect(ri.newGrowthRate).toBe(0);
    expect(ri.soldFractionByAccount).toEqual({});
  });

  it("resolves a scenario-ADDED reinvestment: populated newGrowthRate, newRealization, soldFractionByAccount", () => {
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [addReinvestmentChange()],
      {},
      [],
      makeResolutionContext(),
    );
    expect(effectiveTree.reinvestments).toHaveLength(1);
    const ri = effectiveTree.reinvestments![0];
    // mp-conservative: 20% equity (0.08) + 80% bond (0.03) = 0.04.
    expect(ri.newGrowthRate).toBeCloseTo(0.04);
    expect(ri.newRealization).toBeDefined();
    expect(ri.newRealization!.pctOrdinaryIncome).toBeCloseTo(0.8);
    // Base 100% equity -> conservative 20% equity: sells 80% of the account.
    expect(ri.soldFractionByAccount["a-brokerage"]).toBeCloseTo(0.8);
    // It does NOT crash and the resolved fields are real numbers.
    expect(typeof ri.newGrowthRate).toBe("number");
  });

  it("resolves a scenario-EDITED reinvestment (raw-keyed diff) so the edit is not silently ignored", () => {
    const base = baseTree();
    // A base reinvestment targeting the aggressive portfolio.
    base.reinvestments = [
      {
        id: "ri-1",
        name: "Switch",
        accountIds: ["a-brokerage"],
        year: 2035,
        newGrowthRate: 0.08,
        newRealization: {
          pctOrdinaryIncome: 0,
          pctLtCapitalGains: 0.8,
          pctQualifiedDividends: 0.2,
          pctTaxExempt: 0,
          turnoverPct: 0,
        },
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: { "a-brokerage": 0 },
        yearRef: null,
        targetType: "model_portfolio",
        modelPortfolioId: "mp-aggressive",
        customGrowthRate: null,
        customPctOrdinaryIncome: null,
        customPctLtCapitalGains: null,
        customPctQualifiedDividends: null,
        customPctTaxExempt: null,
      } as Reinvestment,
    ];
    // Scenario edit: retarget to the conservative portfolio.
    const editChange: ScenarioChange = {
      id: "ch1",
      scenarioId: "scn1",
      opType: "edit",
      targetKind: "reinvestment",
      targetId: "ri-1",
      payload: {
        modelPortfolioId: { from: "mp-aggressive", to: "mp-conservative" },
      },
      toggleGroupId: null,
      orderIndex: 0,
    };
    const { effectiveTree } = applyScenarioChangesWithRefs(
      base,
      [editChange],
      {},
      [],
      makeResolutionContext(),
    );
    const ri = effectiveTree.reinvestments![0];
    // The edit must flow through to the resolved fields, not be ignored.
    expect(ri.modelPortfolioId).toBe("mp-conservative");
    expect(ri.newGrowthRate).toBeCloseTo(0.04);
    expect(ri.soldFractionByAccount["a-brokerage"]).toBeCloseTo(0.8);
  });

  it("leaves unchanged base reinvestments correct (idempotent re-resolution)", () => {
    const base = baseTree();
    base.reinvestments = [
      {
        id: "ri-1",
        name: "Switch",
        accountIds: ["a-brokerage"],
        year: 2035,
        newGrowthRate: 0.04,
        newRealization: {
          pctOrdinaryIncome: 0.8,
          pctLtCapitalGains: 0.16,
          pctQualifiedDividends: 0.04,
          pctTaxExempt: 0,
          turnoverPct: 0,
        },
        realizeTaxesOnSwitch: false,
        soldFractionByAccount: { "a-brokerage": 0.8 },
        yearRef: null,
        targetType: "model_portfolio",
        modelPortfolioId: "mp-conservative",
        customGrowthRate: null,
        customPctOrdinaryIncome: null,
        customPctLtCapitalGains: null,
        customPctQualifiedDividends: null,
        customPctTaxExempt: null,
      } as Reinvestment,
    ];
    // An unrelated change (a different added reinvestment) still triggers a
    // full re-resolution pass; the untouched base reinvestment stays correct.
    const { effectiveTree } = applyScenarioChangesWithRefs(
      base,
      [],
      {},
      [],
      makeResolutionContext(),
    );
    const ri = effectiveTree.reinvestments![0];
    expect(ri.newGrowthRate).toBeCloseTo(0.04);
    expect(ri.soldFractionByAccount["a-brokerage"]).toBeCloseTo(0.8);
  });

  // A reinvestment can target account GROUPS as well as individual accounts. The
  // engine reads only the expanded `accountIds`; the base load expands groups, but
  // a scenario `add` / `edit` writes just the form's raw picks — `groupKeys` plus
  // the individually picked ids — so the overlay has to expand them too, or a
  // group-only reinvestment targets nothing and projects as a no-op.
  describe("group targets", () => {
    const groupTree = (): ClientData => {
      const tree = baseTree();
      tree.accounts = [
        { id: "a-brokerage", category: "taxable" },
        { id: "a-cash", category: "cash" },
        { id: "a-ira", category: "retirement" },
        { id: "a-house", category: "real_estate" },
      ] as unknown as ClientData["accounts"];
      return tree;
    };
    const groupOnlyAdd = (groupKeys: string[], over: Record<string, unknown> = {}): ScenarioChange => {
      const change = addReinvestmentChange();
      return {
        ...change,
        toggleGroupId: (over.toggleGroupId as string | null | undefined) ?? null,
        payload: { ...(change.payload as object), accountIds: [], groupKeys },
      };
    };

    it("expands a default group key on a scenario-added, group-only reinvestment", () => {
      const { effectiveTree } = applyScenarioChangesWithRefs(
        groupTree(),
        [groupOnlyAdd(["taxable"])],
        {},
        [],
        makeResolutionContext(),
      );
      const ri = effectiveTree.reinvestments![0];
      expect(ri.accountIds).toEqual(["a-brokerage"]);
      expect(ri.groupKeys).toEqual(["taxable"]);
      // The resolved turnover follows the expanded accounts, so the switch bites.
      expect(ri.soldFractionByAccount["a-brokerage"]).toBeCloseTo(0.8);
    });

    it("expands all-liquid to every liquid account and never an illiquid one", () => {
      const { effectiveTree } = applyScenarioChangesWithRefs(
        groupTree(),
        [groupOnlyAdd(["all-liquid"])],
        {},
        [],
        makeResolutionContext(),
      );
      expect([...effectiveTree.reinvestments![0].accountIds].sort()).toEqual(
        ["a-brokerage", "a-cash", "a-ira"],
      );
    });

    it("expands a custom group from the context's member map and keeps the individual picks", () => {
      const ctx = makeResolutionContext();
      ctx.accountGroupMembersById = new Map([["grp-custom", ["a-cash"]]]);
      const change = groupOnlyAdd(["grp-custom"]);
      (change.payload as { accountIds: string[] }).accountIds = ["a-ira"];
      const { effectiveTree } = applyScenarioChangesWithRefs(groupTree(), [change], {}, [], ctx);
      expect([...effectiveTree.reinvestments![0].accountIds].sort()).toEqual(["a-cash", "a-ira"]);
    });

    it("re-expands when a scenario edit changes only the group keys", () => {
      const base = groupTree();
      base.reinvestments = [
        {
          id: "ri-1",
          name: "Switch",
          accountIds: ["a-brokerage"],
          groupKeys: ["taxable"],
          year: 2035,
          newGrowthRate: 0,
          soldFractionByAccount: {},
          realizeTaxesOnSwitch: false,
          targetType: "model_portfolio",
          modelPortfolioId: "mp-conservative",
        } as Reinvestment,
      ];
      const edit: ScenarioChange = {
        id: "ch1",
        scenarioId: "scn1",
        opType: "edit",
        targetKind: "reinvestment",
        targetId: "ri-1",
        payload: { accountIds: { from: ["a-brokerage"], to: [] }, groupKeys: { from: ["taxable"], to: ["cash"] } },
        toggleGroupId: null,
        orderIndex: 0,
      };
      const { effectiveTree } = applyScenarioChangesWithRefs(base, [edit], {}, [], makeResolutionContext());
      expect(effectiveTree.reinvestments![0].accountIds).toEqual(["a-cash"]);
    });

    it("does not expand a reinvestment whose toggle group is switched off", () => {
      const group = { id: "g1", scenarioId: "scn1", name: "G", defaultOn: true, requiresGroupId: null, orderIndex: 0 };
      const { effectiveTree } = applyScenarioChangesWithRefs(
        groupTree(),
        [groupOnlyAdd(["taxable"], { toggleGroupId: "g1" })],
        { g1: false },
        [group],
        makeResolutionContext(),
      );
      expect(effectiveTree.reinvestments ?? []).toEqual([]);
    });

    it("leaves a reinvestment with no group keys exactly as it was", () => {
      const { effectiveTree } = applyScenarioChangesWithRefs(
        groupTree(),
        [addReinvestmentChange()],
        {},
        [],
        makeResolutionContext(),
      );
      expect(effectiveTree.reinvestments![0].accountIds).toEqual(["a-brokerage"]);
    });
  });

  // The base load keeps a reinvestment's one-by-one picks (`pickedAccountIds`)
  // beside the engine's `accountIds` — the picks UNIONED with every member its
  // groups expand to. The editors write the picks and the groups, never the
  // union, so the overlay recomputes the union from the effective picks and
  // groups: removing a group drops its members, and nothing else moves.
  describe("individual picks", () => {
    const tree = (): ClientData => {
      const t = baseTree();
      t.accounts = [
        { id: "a-brokerage", category: "taxable" },
        { id: "a-cash", category: "cash" },
        { id: "a-ira", category: "retirement" },
      ] as unknown as ClientData["accounts"];
      return t;
    };
    /** A base reinvestment exactly as `loadClientData` builds it: the picks,
     *  the groups, and `accountIds` expanded from both over the base accounts. */
    const baseReinvestment = (t: ClientData, picks: string[], groupKeys: string[]): Reinvestment =>
      ({
        id: "ri-1",
        name: "Switch",
        pickedAccountIds: picks,
        groupKeys,
        accountIds: expandReinvestmentTargets(picks, groupKeys, {
          accountCategoryById: new Map(t.accounts.map((a) => [a.id, a.category as AccountCategory])),
          customGroupMembersById: new Map(),
        }),
        year: 2035,
        newGrowthRate: 0,
        soldFractionByAccount: {},
        realizeTaxesOnSwitch: false,
        yearRef: null,
        targetType: "model_portfolio",
        modelPortfolioId: "mp-conservative",
      }) as Reinvestment;
    const groupedBase = () => {
      const t = tree();
      t.reinvestments = [baseReinvestment(t, ["a-ira"], ["taxable"])];
      return t;
    };
    const edit = (payload: Record<string, unknown>, toggleGroupId: string | null = null): ScenarioChange => ({
      id: "ch-edit",
      scenarioId: "scn1",
      opType: "edit",
      targetKind: "reinvestment",
      targetId: "ri-1",
      payload,
      toggleGroupId,
      orderIndex: 0,
    });
    const effective = (base: ClientData, changes: ScenarioChange[], toggles = {}, groups: never[] = []) =>
      applyScenarioChangesWithRefs(base, changes, toggles, groups, makeResolutionContext()).effectiveTree
        .reinvestments![0];

    it("an unchanged scenario carries the base reinvestment exactly as base does", () => {
      const base = groupedBase();
      const [expected] = resolveReinvestments(base.reinvestments!, {
        resolver: makeResolutionContext().resolver,
        accountBaseAllocByAccountId: makeResolutionContext().accountBaseAllocByAccountId!,
      });
      expect(effective(base, [])).toStrictEqual(expected);
    });

    it("removing a group drops that group's members, keeping the picks", () => {
      // The edit the Details form saves: only the groups changed.
      const ri = effective(groupedBase(), [edit({ groupKeys: { from: ["taxable"], to: [] } })]);
      expect(ri.accountIds).toEqual(["a-ira"]);
      expect(ri.pickedAccountIds).toEqual(["a-ira"]);
    });

    it("changing only the picks keeps the group's members", () => {
      const ri = effective(groupedBase(), [edit({ pickedAccountIds: { from: ["a-ira"], to: ["a-cash"] } })]);
      expect([...ri.accountIds].sort()).toEqual(["a-brokerage", "a-cash"]);
    });

    it("a group removal in a switched-off toggle group changes nothing", () => {
      const group = { id: "g1", scenarioId: "scn1", name: "G", defaultOn: true, requiresGroupId: null, orderIndex: 0 };
      const ri = effective(
        groupedBase(),
        [edit({ groupKeys: { from: ["taxable"], to: [] } }, "g1")],
        { g1: false },
        [group as never],
      );
      expect([...ri.accountIds].sort()).toEqual(["a-brokerage", "a-ira"]);
      expect(ri.groupKeys).toEqual(["taxable"]);
    });

    it("a picked account the scenario removed is not added back from the picks", () => {
      const base = tree();
      base.reinvestments = [baseReinvestment(base, ["a-cash", "a-ira"], [])];
      const removeCash: ScenarioChange = {
        id: "ch-rm",
        scenarioId: "scn1",
        opType: "remove",
        targetKind: "account",
        targetId: "a-cash",
        payload: null,
        toggleGroupId: null,
        orderIndex: 1,
      };
      expect(effective(base, [removeCash]).accountIds).toEqual(["a-ira"]);
    });

    // Change rows written before the picks key existed carry the picks in
    // `accountIds`. They must keep meaning what they meant.
    describe("legacy rows with only accountIds", () => {
      it("a legacy add targets its accountIds as the picks", () => {
        const add = addReinvestmentChange();
        add.payload = { ...(add.payload as object), accountIds: ["a-ira"], groupKeys: ["cash"] };
        const ri = effective(tree(), [add]);
        expect(ri.pickedAccountIds).toEqual(["a-ira"]);
        expect([...ri.accountIds].sort()).toEqual(["a-cash", "a-ira"]);
      });

      it("a legacy edit's accountIds replace the base picks", () => {
        const ri = effective(groupedBase(), [
          edit({ accountIds: { from: ["a-ira", "a-brokerage"], to: ["a-cash"] } }),
        ]);
        expect(ri.pickedAccountIds).toEqual(["a-cash"]);
        expect([...ri.accountIds].sort()).toEqual(["a-brokerage", "a-cash"]);
      });
    });
  });
});
