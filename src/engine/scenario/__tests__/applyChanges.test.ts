// src/engine/scenario/__tests__/applyChanges.test.ts
import { describe, it, expect } from "vitest";
import { resolveEffectiveToggleState } from "../applyChanges";
import { applyScenarioChanges } from "../applyChanges";
import type { ToggleGroup } from "../types";
import type { ClientData, Account } from "@/engine/types";
import type { ScenarioChange } from "../types";

describe("resolveEffectiveToggleState", () => {
  const independentGroup: ToggleGroup = {
    id: "g1",
    scenarioId: "s1",
    name: "g1",
    defaultOn: true,
    requiresGroupId: null,
    orderIndex: 0,
  };

  const childGroup: ToggleGroup = {
    id: "g2",
    scenarioId: "s1",
    name: "g2",
    defaultOn: true,
    requiresGroupId: "g1",
    orderIndex: 1,
  };

  it("returns explicit state for groups with no parent", () => {
    const result = resolveEffectiveToggleState(
      { g1: true },
      [independentGroup],
    );
    expect(result).toEqual({ g1: true });
  });

  it("falls back to defaultOn when state is missing", () => {
    const result = resolveEffectiveToggleState({}, [independentGroup]);
    expect(result).toEqual({ g1: true });
  });

  it("forces child off when parent is off", () => {
    const result = resolveEffectiveToggleState(
      { g1: false, g2: true },
      [independentGroup, childGroup],
    );
    expect(result).toEqual({ g1: false, g2: false });
  });

  it("respects child's own state when parent is on", () => {
    const result = resolveEffectiveToggleState(
      { g1: true, g2: false },
      [independentGroup, childGroup],
    );
    expect(result).toEqual({ g1: true, g2: false });
  });
});

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
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  planSettings: {} as ClientData["planSettings"],
});

describe("applyScenarioChanges — add", () => {
  it("appends a new account to the effective tree", () => {
    const base = minimalClientData();
    const newAccount: Account = {
      id: "a-new",
      clientId: "c1",
      scenarioId: "s-base",
      name: "Roth IRA — Client",
      category: "retirement",
      subType: "roth_ira",
      owner: "client",
      value: 0,
      basis: 0,
    } as unknown as Account;

    const change: ScenarioChange = {
      id: "ch1",
      scenarioId: "s1",
      opType: "add",
      targetKind: "account",
      targetId: "a-new",
      payload: newAccount,
      toggleGroupId: null,
      orderIndex: 0,
    };

    const result = applyScenarioChanges(base, [change], {}, []);
    expect(result.effectiveTree.accounts).toHaveLength(1);
    expect(result.effectiveTree.accounts[0].id).toBe("a-new");
    expect(result.effectiveTree.accounts[0].name).toBe("Roth IRA — Client");
    expect(result.warnings).toEqual([]);
  });

  it("does not mutate the base tree", () => {
    const base = minimalClientData();
    const newAccount = { id: "a-new", name: "x" } as unknown as Account;
    applyScenarioChanges(
      base,
      [{
        id: "ch1", scenarioId: "s1", opType: "add",
        targetKind: "account", targetId: "a-new",
        payload: newAccount, toggleGroupId: null, orderIndex: 0,
      }],
      {},
      [],
    );
    expect(base.accounts).toEqual([]);
  });
});

describe("applyScenarioChanges — edit", () => {
  it("applies field diff to a base entity", () => {
    const base = minimalClientData();
    base.accounts = [{
      id: "a-base",
      clientId: "c1",
      scenarioId: "s-base",
      name: "401(k) — Client",
      category: "retirement",
      subType: "traditional_401k",
      owner: "client",
      value: 250000,
      basis: 0,
    } as unknown as Account];

    const change: ScenarioChange = {
      id: "ch1",
      scenarioId: "s1",
      opType: "edit",
      targetKind: "account",
      targetId: "a-base",
      payload: { value: { from: 250000, to: 350000 } },
      toggleGroupId: null,
      orderIndex: 0,
    };

    const result = applyScenarioChanges(base, [change], {}, []);
    expect(result.effectiveTree.accounts[0].value).toBe(350000);
  });

  it("no-ops when target was added by an earlier add change in same scenario", () => {
    const base = minimalClientData();
    const addedAccount: Account = {
      id: "a-new",
      clientId: "c1",
      scenarioId: "s-base",
      name: "Roth IRA",
      category: "retirement",
      subType: "roth_ira",
      owner: "client",
      value: 100000,
      basis: 0,
    } as unknown as Account;

    const addChange: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "add", targetKind: "account",
      targetId: "a-new", payload: addedAccount, toggleGroupId: null, orderIndex: 0,
    };
    const editChange: ScenarioChange = {
      id: "ch2", scenarioId: "s1", opType: "edit", targetKind: "account",
      targetId: "a-new", payload: { value: { from: 100000, to: 200000 } },
      toggleGroupId: null, orderIndex: 1,
    };

    const result = applyScenarioChanges(base, [addChange, editChange], {}, []);
    // The add payload reflects whatever the UI saved; the edit should not
    // double-apply on top of an already-added entity.
    expect(result.effectiveTree.accounts).toHaveLength(1);
    expect(result.effectiveTree.accounts[0].value).toBe(100000);
  });

  it("applies edit to plan_settings (singleton)", () => {
    const base = minimalClientData();
    base.planSettings = { taxBracketCap: 0.24 } as unknown as ClientData["planSettings"];

    const change: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "edit", targetKind: "plan_settings",
      targetId: "ps-1", payload: { taxBracketCap: { from: 0.24, to: 0.22 } },
      toggleGroupId: null, orderIndex: 0,
    };

    const result = applyScenarioChanges(base, [change], {}, []);
    expect((result.effectiveTree.planSettings as unknown as { taxBracketCap: number }).taxBracketCap).toBe(0.22);
  });
});

describe("applyScenarioChanges — remove", () => {
  it("removes a base account from the effective tree", () => {
    const base = minimalClientData();
    base.accounts = [
      { id: "a1", name: "Keep" } as unknown as Account,
      { id: "a2", name: "Remove me" } as unknown as Account,
    ];

    const change: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "remove", targetKind: "account",
      targetId: "a2", payload: null, toggleGroupId: null, orderIndex: 0,
    };

    const result = applyScenarioChanges(base, [change], {}, []);
    expect(result.effectiveTree.accounts).toHaveLength(1);
    expect(result.effectiveTree.accounts[0].id).toBe("a1");
  });

  it("removing a non-existent target is a no-op", () => {
    const base = minimalClientData();
    base.accounts = [{ id: "a1", name: "Keep" } as unknown as Account];

    const change: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "remove", targetKind: "account",
      targetId: "a-missing", payload: null, toggleGroupId: null, orderIndex: 0,
    };

    const result = applyScenarioChanges(base, [change], {}, []);
    expect(result.effectiveTree.accounts).toHaveLength(1);
  });
});

describe("applyScenarioChanges — toggle filtering", () => {
  const groupParent: ToggleGroup = {
    id: "g-parent", scenarioId: "s1", name: "parent",
    defaultOn: true, requiresGroupId: null, orderIndex: 0,
  };
  const groupChild: ToggleGroup = {
    id: "g-child", scenarioId: "s1", name: "child",
    defaultOn: true, requiresGroupId: "g-parent", orderIndex: 1,
  };

  it("skips changes whose toggle group is off", () => {
    const base = minimalClientData();
    const change: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "add", targetKind: "account",
      targetId: "a-new", payload: { id: "a-new", name: "Roth" } as Account,
      toggleGroupId: "g-parent", orderIndex: 0,
    };
    const result = applyScenarioChanges(base, [change], { "g-parent": false }, [groupParent]);
    expect(result.effectiveTree.accounts).toEqual([]);
  });

  it("skips child group changes when parent is off", () => {
    const base = minimalClientData();
    const change: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "add", targetKind: "account",
      targetId: "a-new", payload: { id: "a-new", name: "Roth" } as Account,
      toggleGroupId: "g-child", orderIndex: 0,
    };
    const result = applyScenarioChanges(
      base,
      [change],
      { "g-parent": false, "g-child": true },
      [groupParent, groupChild],
    );
    expect(result.effectiveTree.accounts).toEqual([]);
  });

  it("ungrouped changes apply even when all toggle groups are off", () => {
    const base = minimalClientData();
    const change: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "add", targetKind: "account",
      targetId: "a-new", payload: { id: "a-new", name: "Roth" } as Account,
      toggleGroupId: null, orderIndex: 0,
    };
    const result = applyScenarioChanges(
      base,
      [change],
      { "g-parent": false },
      [groupParent],
    );
    expect(result.effectiveTree.accounts).toHaveLength(1);
  });
});

describe("applyScenarioChanges — order of operations", () => {
  it("respects orderIndex ordering", () => {
    const base = minimalClientData();
    const c1: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "add", targetKind: "account",
      targetId: "a1", payload: { id: "a1", name: "first" } as Account,
      toggleGroupId: null, orderIndex: 1,
    };
    const c2: ScenarioChange = {
      id: "ch2", scenarioId: "s1", opType: "add", targetKind: "account",
      targetId: "a2", payload: { id: "a2", name: "second" } as Account,
      toggleGroupId: null, orderIndex: 0,
    };
    const result = applyScenarioChanges(base, [c1, c2], {}, []);
    expect(result.effectiveTree.accounts.map((a) => a.id)).toEqual(["a2", "a1"]);
  });

  it("tie-breaks add before edit when orderIndex is equal", () => {
    const base = minimalClientData();
    const editChange: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "edit", targetKind: "account",
      targetId: "a-new", payload: { value: { from: 0, to: 100 } },
      toggleGroupId: null, orderIndex: 5,
    };
    const addChange: ScenarioChange = {
      id: "ch2", scenarioId: "s1", opType: "add", targetKind: "account",
      targetId: "a-new",
      payload: { id: "a-new", name: "Roth", value: 0 } as Account,
      toggleGroupId: null, orderIndex: 5,
    };
    const result = applyScenarioChanges(base, [editChange, addChange], {}, []);
    // add applied first; edit then no-ops because target was scenario-added
    expect(result.effectiveTree.accounts).toHaveLength(1);
    expect(result.effectiveTree.accounts[0].value).toBe(0);
  });

  it("tie-breaks edit before remove at equal orderIndex (defensive)", () => {
    const base = minimalClientData();
    base.accounts = [{ id: "a1", value: 100 } as Account];
    const removeChange: ScenarioChange = {
      id: "ch1", scenarioId: "s1", opType: "remove", targetKind: "account",
      targetId: "a1", payload: null, toggleGroupId: null, orderIndex: 5,
    };
    const editChange: ScenarioChange = {
      id: "ch2", scenarioId: "s1", opType: "edit", targetKind: "account",
      targetId: "a1", payload: { value: { from: 100, to: 200 } },
      toggleGroupId: null, orderIndex: 5,
    };
    // edit applies first (sets value=200), then remove drops it
    const result = applyScenarioChanges(base, [removeChange, editChange], {}, []);
    expect(result.effectiveTree.accounts).toEqual([]);
  });
});
