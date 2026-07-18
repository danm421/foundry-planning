/**
 * Audit F13, saved-scenario half.
 *
 * Task 5 taught the LIVE solver (`applyMutations`, entity-upsert) to synthesize
 * an entity's default checking account. That fix evaporates on save + reload:
 * `mutations-to-scenario-changes.ts` persists entity-upsert as a single
 * `targetKind: "entity"` row, and `applyChanges.ts` pushes that entity into
 * `tree.entities` without creating any account. The saved scenario — which is
 * what reports and presentations actually project — is back to zero payments.
 *
 * The loader must therefore synthesize the SAME account on load. "Same" is the
 * crux: if the live tree and the reloaded tree disagree, the advisor sees one
 * projection while steering and a different one after saving. The parity test
 * below deep-equals the two synthesized accounts rather than re-asserting the
 * field list, so any drift in either implementation fails here.
 */
import { describe, it, expect } from "vitest";
import { applyScenarioChangesWithRefs } from "../loader";
import { withSynthesizedEntityChecking } from "@/lib/entities/entity-checking";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import { runProjection } from "@/engine/projection";
import { isFullyEntityOwned } from "@/engine/ownership";
import {
  buildCltLifecycleFixture,
  CLT_FIXTURE_IDS,
} from "@/engine/__tests__/_fixtures/clt";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { SolverMutation } from "@/lib/solver/types";

const TRUST_ID = "00000000-0000-0000-0000-0000000007a1";

const trustEntity: EntitySummary = {
  id: TRUST_ID,
  name: "Scenario CRT",
  includeInPortfolio: false,
  isGrantor: false,
  isIrrevocable: true,
  trustSubType: "crt",
} as EntitySummary;

function baseTree(accounts: Account[] = [], entities: EntitySummary[] = []): ClientData {
  return {
    client: {
      dateOfBirth: "1970-06-15",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      lifeExpectancy: 90,
      filingStatus: "single",
      state: "PA",
      familyMembers: [],
    },
    planSettings: {
      planStartYear: 2025,
      planEndYear: 2030,
      inflationRate: 0,
      taxMode: "flat",
      flatTaxRate: 0,
    },
    accounts,
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    entities,
    withdrawalStrategy: [],
    transfers: [],
    rothConversions: [],
    reinvestments: [],
  } as unknown as ClientData;
}

const addEntityChange: ScenarioChange = {
  id: "ch-entity",
  scenarioId: "scn1",
  opType: "add",
  targetKind: "entity",
  targetId: TRUST_ID,
  payload: trustEntity,
  toggleGroupId: null,
  orderIndex: 0,
} as unknown as ScenarioChange;

const upsertEntityMutation: SolverMutation = {
  kind: "entity-upsert",
  id: TRUST_ID,
  value: trustEntity,
} as unknown as SolverMutation;

const entityCheckingOf = (tree: ClientData, entityId: string): Account[] =>
  tree.accounts.filter((a) =>
    a.owners.some((o) => o.kind === "entity" && o.entityId === entityId),
  );

describe("F13 — loader synthesizes checking for scenario-added entities", () => {
  it("produces an account byte-identical to the live solver's", () => {
    // Same entity, same starting tree, two routes in: live mutation vs saved
    // scenario change. The synthesized accounts must be indistinguishable.
    const live = applyMutations(baseTree(), [upsertEntityMutation]);
    const { effectiveTree: saved } = applyScenarioChangesWithRefs(
      baseTree(),
      [addEntityChange],
      {},
      [],
    );

    const liveChecking = entityCheckingOf(live, TRUST_ID);
    const savedChecking = entityCheckingOf(saved, TRUST_ID);

    expect(liveChecking).toHaveLength(1);
    expect(savedChecking).toHaveLength(1);
    expect(savedChecking[0]).toEqual(liveChecking[0]);

    // Called out explicitly because toEqual would pass if BOTH grew a
    // persistence-only field: the effective tree is not a DB row.
    expect(savedChecking[0]).not.toHaveProperty("scenarioId");
    expect(savedChecking[0]).not.toHaveProperty("clientId");
  });

  it("satisfies the engine predicate that gates entityCheckingByEntityId", () => {
    // projection.ts:556-563 skips any isDefaultChecking account that fails
    // isFullyEntityOwned, so an account that appears but fails this predicate
    // leaves F13 wide open.
    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree(),
      [addEntityChange],
      {},
      [],
    );
    const checking = entityCheckingOf(effectiveTree, TRUST_ID)[0];
    expect(checking.isDefaultChecking).toBe(true);
    expect(isFullyEntityOwned(checking)).toBe(true);
  });

  it("leaves an advisor-created entity checking account alone", () => {
    const real: Account = {
      id: "advisor-created-trust-cash",
      name: "Trust Operating Cash",
      category: "cash",
      subType: "checking",
      value: 250_000,
      basis: 250_000,
      growthRate: 0.02,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    } as unknown as Account;

    const { effectiveTree } = applyScenarioChangesWithRefs(
      baseTree([real]),
      [addEntityChange],
      {},
      [],
    );
    const checking = entityCheckingOf(effectiveTree, TRUST_ID);
    expect(checking).toHaveLength(1);
    expect(checking[0]).toEqual(real);
  });

  it("is a no-op when re-applied to its own output", () => {
    const once = applyScenarioChangesWithRefs(baseTree(), [addEntityChange], {}, []);
    const twice = applyScenarioChangesWithRefs(
      once.effectiveTree,
      [],
      {},
      [],
    );
    // Length assertion first: comparing two empty arrays would pass without
    // the synthesis ever having run.
    expect(entityCheckingOf(twice.effectiveTree, TRUST_ID)).toHaveLength(1);
    expect(entityCheckingOf(twice.effectiveTree, TRUST_ID)).toEqual(
      entityCheckingOf(once.effectiveTree, TRUST_ID),
    );
  });
});

describe("withSynthesizedEntityChecking — same-reference no-op", () => {
  // Load-bearing: the loader's base-case fast path deliberately returns the DB
  // tree with zero work. Dropping this helper onto it is only safe because it
  // hands back the identical object when there is nothing to synthesize.
  it("returns the same tree when there are no entities", () => {
    const tree = baseTree();
    expect(withSynthesizedEntityChecking(tree)).toBe(tree);
  });

  it("returns the same tree when every entity already has checking", () => {
    const real: Account = {
      id: "db-trust-cash",
      name: "Trust — Cash",
      category: "cash",
      subType: "checking",
      value: 0,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    } as unknown as Account;
    const tree = baseTree([real], [trustEntity]);
    expect(withSynthesizedEntityChecking(tree)).toBe(tree);
  });

  it("synthesizes when the entity's only account is not default checking", () => {
    const brokerage: Account = {
      id: "trust-brokerage",
      name: "Trust Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 500_000,
      basis: 400_000,
      growthRate: 0.05,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1 }],
    } as unknown as Account;
    const tree = baseTree([brokerage], [trustEntity]);
    const result = withSynthesizedEntityChecking(tree);

    expect(result).not.toBe(tree);
    expect(entityCheckingOf(result, TRUST_ID)).toHaveLength(2);
    expect(
      entityCheckingOf(result, TRUST_ID).filter((a) => a.isDefaultChecking),
    ).toHaveLength(1);
  });
});

describe("F13 — a scenario-saved CLT actually pays its charity", () => {
  /** The CLT fixture, restaged as "the entity arrived via a saved scenario":
   *  the entity is pulled out of `entities` and re-added as a change row, and
   *  the corpus account loses `isDefaultChecking` — the shape a scenario-added
   *  entity really has, since nothing on the persistence path ever sets it. */
  function stageSavedClt(): { base: ClientData; change: ScenarioChange } {
    const fixture = buildCltLifecycleFixture({
      inceptionYear: 2026,
      payoutPercent: 0.06,
      termYears: 5,
      inceptionValue: 1_000_000,
      charityType: "public",
      grantorAgi: 300_000,
      remainderBeneficiaries: [{ childIndex: 1, percentage: 100 }],
    });
    const cltEntity = (fixture.entities ?? []).find(
      (e) => e.id === CLT_FIXTURE_IDS.CLT_ENTITY_ID,
    )!;
    const corpus = fixture.accounts.find(
      (a) => a.id === CLT_FIXTURE_IDS.CLT_CHECKING_ID,
    )!;
    delete (corpus as { isDefaultChecking?: boolean }).isDefaultChecking;

    return {
      base: {
        ...fixture,
        entities: (fixture.entities ?? []).filter(
          (e) => e.id !== CLT_FIXTURE_IDS.CLT_ENTITY_ID,
        ),
      },
      change: {
        id: "ch-clt",
        scenarioId: "scn1",
        opType: "add",
        targetKind: "entity",
        targetId: CLT_FIXTURE_IDS.CLT_ENTITY_ID,
        payload: cltEntity,
        toggleGroupId: null,
        orderIndex: 0,
      } as unknown as ScenarioChange,
    };
  }

  const hasMissingCheckingWarning = (
    years: ReturnType<typeof runProjection>,
  ): boolean =>
    years.some((y) =>
      y.trustWarnings?.some((w) => w.code === "entity_missing_checking"),
    );

  const totalCharitableOutflows = (
    years: ReturnType<typeof runProjection>,
  ): number => years.reduce((s, y) => s + (y.charitableOutflows ?? 0), 0);

  it("CONTROL — raw applyScenarioChanges leaves the CLT payment-less", () => {
    // Proves the staging above really reproduces F13. Without this control a
    // green subject test could be measuring a fixture that was never broken.
    const { base, change } = stageSavedClt();
    const { effectiveTree } = applyScenarioChanges(base, [change], {}, []);
    const years = runProjection(effectiveTree);

    expect(hasMissingCheckingWarning(years)).toBe(true);
    expect(totalCharitableOutflows(years)).toBe(0);
  });

  it("SUBJECT — the loader's effective tree pays the charity", () => {
    const { base, change } = stageSavedClt();
    const { effectiveTree } = applyScenarioChangesWithRefs(base, [change], {}, []);
    const years = runProjection(effectiveTree);

    expect(hasMissingCheckingWarning(years)).toBe(false);
    expect(totalCharitableOutflows(years)).toBeGreaterThan(0);
  });
});
