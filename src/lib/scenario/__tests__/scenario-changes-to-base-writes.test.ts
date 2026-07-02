import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";
import {
  scenarioChangesToBaseWrites,
  collectExternalDedicatedAccountIds,
} from "../scenario-changes-to-base-writes";
import type { BaseWritePlan } from "../promote-to-base-types";

const minimalClientData = (): ClientData => ({
  client: {
    id: "c1",
    firstName: "Test",
    lastName: "Client",
    dateOfBirth: "1980-01-01",
    retirementAge: 65,
    spouseDateOfBirth: null,
    spouseRetirementAge: null,
    state: "CA",
    filingStatus: "married_joint",
    targetRetirementSpending: 0,
    deathYear: 2080,
    spouseDeathYear: 2080,
  } as unknown as ClientData["client"],
  accounts: [{ id: "a1", name: "Brokerage", category: "taxable", value: 100 } as never],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: { id: "ps1" } as unknown as ClientData["planSettings"],
  giftEvents: [],
});

const baseChange = {
  scenarioId: "s1",
  toggleGroupId: null as string | null,
  orderIndex: 0,
};

describe("scenarioChangesToBaseWrites", () => {
  it("maps an edit change to a BaseUpdate with only the changed column", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch1",
        opType: "edit",
        targetKind: "account",
        targetId: "a1",
        payload: { value: { from: 100, to: 250 } },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.updates).toEqual([{ kind: "account", id: "a1", set: { value: 250 } }]);
    expect(plan.inserts).toHaveLength(0);
  });

  it("maps an add change to a BaseInsert carrying the raw payload", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch2",
        opType: "add",
        targetKind: "income",
        targetId: "new-inc",
        payload: { id: "new-inc", name: "Rental", type: "other", annualAmount: 12000 },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.inserts).toEqual([
      {
        kind: "income",
        targetId: "new-inc",
        raw: { id: "new-inc", name: "Rental", type: "other", annualAmount: 12000 },
      },
    ]);
  });

  it("maps a remove change to a non-cascade BaseRemove", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch3",
        opType: "remove",
        targetKind: "account",
        targetId: "a1",
        payload: null,
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.removes).toContainEqual({ kind: "account", id: "a1", cascade: false });
  });

  it("excludes changes whose toggle group is OFF", () => {
    const groups: ToggleGroup[] = [
      { id: "g1", scenarioId: "s1", name: "Roth", defaultOn: false, requiresGroupId: null, orderIndex: 0 },
    ];
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch4",
        opType: "edit",
        targetKind: "account",
        targetId: "a1",
        toggleGroupId: "g1",
        payload: { value: { from: 100, to: 999 } },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, groups, {});
    expect(plan.updates).toHaveLength(0); // g1 defaultOn=false, no override → off
  });

  it("maps client/plan_settings edits to singletonUpdates", () => {
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch5",
        opType: "edit",
        targetKind: "plan_settings",
        targetId: "ps1",
        payload: { inflationRate: { from: 0.03, to: 0.025 } },
      },
    ];
    const plan = scenarioChangesToBaseWrites(minimalClientData(), changes, [], {});
    expect(plan.singletonUpdates).toEqual([
      { kind: "plan_settings", set: { inflationRate: 0.025 } },
    ]);
  });

  it("folds an engine cascade drop into a cascade BaseRemove", () => {
    const tree = minimalClientData();
    tree.transfers = [
      {
        id: "t1",
        name: "Sweep",
        sourceAccountId: "a1",
        targetAccountId: "a2",
        amount: 1000,
        mode: "one_time",
        startYear: 2030,
        growthRate: 0,
        schedules: [],
      } as never,
    ];
    const changes: ScenarioChange[] = [
      {
        ...baseChange,
        id: "ch6",
        opType: "remove",
        targetKind: "account",
        targetId: "a1",
        payload: null,
      },
    ];
    const plan = scenarioChangesToBaseWrites(tree, changes, [], {});
    expect(plan.removes).toContainEqual({ kind: "account", id: "a1", cascade: false });
    expect(plan.removes).toContainEqual({ kind: "transfer", id: "t1", cascade: true });
  });
});

describe("collectExternalDedicatedAccountIds", () => {
  const plan = (over: Partial<BaseWritePlan>): BaseWritePlan => ({
    inserts: [],
    updates: [],
    singletonUpdates: [],
    removes: [],
    ...over,
  });

  it("collects dedicated ids from expense inserts and updates", () => {
    const ids = collectExternalDedicatedAccountIds(
      plan({
        inserts: [
          { kind: "expense", targetId: "e1", raw: { dedicatedAccountIds: ["a1", "a2"] } },
        ],
        updates: [{ kind: "expense", id: "e2", set: { dedicatedAccountIds: ["a3"] } }],
      }),
    );
    expect(ids.sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("skips ids satisfied by an in-batch account insert (remapped in-txn)", () => {
    const ids = collectExternalDedicatedAccountIds(
      plan({
        inserts: [
          { kind: "account", targetId: "syn-529", raw: {} },
          { kind: "expense", targetId: "e1", raw: { dedicatedAccountIds: ["syn-529", "a1"] } },
        ],
      }),
    );
    expect(ids).toEqual(["a1"]);
  });

  it("dedupes and ignores non-expense rows and absent fields", () => {
    const ids = collectExternalDedicatedAccountIds(
      plan({
        inserts: [
          { kind: "expense", targetId: "e1", raw: { dedicatedAccountIds: ["a1", "a1"] } },
          { kind: "expense", targetId: "e2", raw: {} },
          { kind: "income", targetId: "i1", raw: { dedicatedAccountIds: ["nope"] } },
        ],
        updates: [
          { kind: "expense", id: "e3", set: { annualAmount: 5 } },
          { kind: "account", id: "a9", set: { dedicatedAccountIds: ["nope2"] } },
        ],
      }),
    );
    expect(ids).toEqual(["a1"]);
  });
});
