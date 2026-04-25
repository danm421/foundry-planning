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
