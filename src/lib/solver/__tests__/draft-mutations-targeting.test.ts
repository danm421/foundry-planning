import { describe, it, expect } from "vitest";
import type { SolverMutation } from "../types";
import { draftMutationsTargeting } from "../draft-mutations-targeting";

describe("draftMutationsTargeting", () => {
  it("matches upserts and field levers for an income", () => {
    const ms: SolverMutation[] = [
      { kind: "income-upsert", id: "i1", value: null },
      { kind: "income-annual-amount", incomeId: "i1", annualAmount: 1 },
      { kind: "income-annual-amount", incomeId: "i2", annualAmount: 1 },
    ];
    expect(draftMutationsTargeting(ms, { kind: "income", id: "i1" })).toEqual(ms.slice(0, 2));
  });

  it("matches expense upsert and levers", () => {
    const ms: SolverMutation[] = [
      { kind: "expense-upsert", id: "e1", value: null },
      { kind: "expense-annual-amount", expenseId: "e1", annualAmount: 1 },
      { kind: "expense-absorbs-remaining", expenseId: "e2", value: true },
    ];
    expect(draftMutationsTargeting(ms, { kind: "expense", id: "e1" })).toEqual(ms.slice(0, 2));
  });

  it("matches liability upsert and debt paydown", () => {
    const ms: SolverMutation[] = [
      { kind: "liability-upsert", id: "l1", value: null },
      { kind: "debt-paydown", liabilityId: "l1", value: null },
      { kind: "debt-paydown", liabilityId: "l2", value: null },
    ];
    expect(draftMutationsTargeting(ms, { kind: "liability", id: "l1" })).toEqual(ms.slice(0, 2));
  });

  it("matches savings levers by the rule's account", () => {
    const ms: SolverMutation[] = [
      { kind: "savings-contribution", accountId: "a1", annualAmount: 5 },
      { kind: "savings-contribution", accountId: "a2", annualAmount: 5 },
      { kind: "savings-rule-upsert", id: "r1", value: null },
    ];
    expect(
      draftMutationsTargeting(ms, { kind: "savings_rule", id: "r1", accountId: "a1" }),
    ).toEqual([ms[0], ms[2]]);
  });

  it("matches an account's savings levers by its own id, plus its upsert", () => {
    const ms: SolverMutation[] = [
      { kind: "account-upsert", id: "a1", value: null },
      { kind: "savings-growth-rate", accountId: "a1", rate: 0.05 },
      { kind: "savings-growth-rate", accountId: "a2", rate: 0.05 },
    ];
    expect(draftMutationsTargeting(ms, { kind: "account", id: "a1" })).toEqual(ms.slice(0, 2));
  });

  it("matches Social Security levers by person", () => {
    const ms: SolverMutation[] = [
      { kind: "ss-claim-age", person: "client", age: 70 },
      { kind: "ss-cola", person: "spouse", rate: 0.02 },
    ];
    expect(
      draftMutationsTargeting(ms, { kind: "income", id: "ss1", person: "client" }),
    ).toEqual([ms[0]]);
  });

  it("matches the client's retirement-age and life-expectancy levers", () => {
    const ms: SolverMutation[] = [
      { kind: "retirement-age", person: "client", age: 65 },
      { kind: "life-expectancy", person: "spouse", age: 90 },
      { kind: "living-expense-scale", multiplier: 1 },
    ];
    expect(draftMutationsTargeting(ms, { kind: "client", id: "c1" })).toEqual(ms.slice(0, 2));
  });

  it("matches entity upsert and flow overrides by entityId", () => {
    const ms: SolverMutation[] = [
      { kind: "entity-upsert", id: "t1", value: null },
      { kind: "entity-flow-override-upsert", entityId: "t1", year: 2030, value: null },
      { kind: "entity-flow-override-upsert", entityId: "t2", year: 2030, value: null },
    ];
    expect(draftMutationsTargeting(ms, { kind: "entity", id: "t1" })).toEqual(ms.slice(0, 2));
  });

  it("matches plain upserts by id for the remaining families", () => {
    const ms: SolverMutation[] = [
      { kind: "note-receivable-upsert", id: "n1", value: null },
      { kind: "gift-upsert", id: "g1", value: null },
      { kind: "will-upsert", id: "w1", value: null },
      { kind: "roth-conversion-upsert", id: "r1", value: null },
      { kind: "asset-transaction-upsert", id: "x1", value: null },
      { kind: "reinvestment-upsert", id: "v1", value: null },
      { kind: "relocation-upsert", id: "m1", value: null },
      { kind: "external-beneficiary-upsert", id: "b1", value: null },
    ];
    const cases: [Parameters<typeof draftMutationsTargeting>[1]["kind"], string, number][] = [
      ["note_receivable", "n1", 0],
      ["gift", "g1", 1],
      ["will", "w1", 2],
      ["roth_conversion", "r1", 3],
      ["asset_transaction", "x1", 4],
      ["reinvestment", "v1", 5],
      ["relocation", "m1", 6],
      ["external_beneficiary", "b1", 7],
    ];
    for (const [kind, id, i] of cases) {
      expect(draftMutationsTargeting(ms, { kind, id })).toEqual([ms[i]]);
    }
  });

  it("supersedes surplus-allocation for the withdrawal tab only", () => {
    const ms: SolverMutation[] = [
      { kind: "surplus-allocation", spendPct: 50, saveAccountId: null, spendAllUntilRetirement: false },
      { kind: "stress-inflation", rate: 0.05 },
    ];
    expect(draftMutationsTargeting(ms, { kind: "plan_settings", id: "withdrawal" })).toEqual([ms[0]]);
    expect(draftMutationsTargeting(ms, { kind: "plan_settings", id: "tax-rates" })).toEqual([]);
  });

  it("supersedes the living-expense levers for a flagged living expense", () => {
    const ms: SolverMutation[] = [
      { kind: "living-expense-scale", multiplier: 1.1 },
      { kind: "living-expense-amount", amount: 9 },
    ];
    expect(draftMutationsTargeting(ms, { kind: "expense", id: "x", livingExpense: true })).toEqual(ms);
    expect(draftMutationsTargeting(ms, { kind: "expense", id: "x" })).toEqual([]);
  });

  it("supersedes a whole trust dissolve when any member is targeted", () => {
    const ms: SolverMutation[] = [
      { kind: "entity-upsert", id: "t1", value: null },
      { kind: "account-upsert", id: "a1", value: null, removedRefId: "t1" },
      { kind: "income-upsert", id: "i1", value: null, removedRefId: "t1" },
      { kind: "expense-upsert", id: "e1", value: null, removedRefId: "t1" },
      { kind: "account-upsert", id: "a2", value: null, removedRefId: "t9" },
    ];
    expect(draftMutationsTargeting(ms, { kind: "entity", id: "t1" })).toEqual(ms.slice(0, 4));
  });

  it("supersedes a whole charity removal", () => {
    const ms: SolverMutation[] = [
      { kind: "external-beneficiary-upsert", id: "b1", value: null },
      { kind: "account-upsert", id: "a1", value: null, removedRefId: "b1" },
    ];
    expect(draftMutationsTargeting(ms, { kind: "external_beneficiary", id: "b1" })).toEqual(ms);
  });

  it("pulls in a note's source-account retitle", () => {
    const ms: SolverMutation[] = [
      { kind: "note-receivable-upsert", id: "n1", value: null, sourceAccountId: "a1" },
      { kind: "account-upsert", id: "a1", value: null },
      { kind: "account-upsert", id: "a2", value: null },
    ];
    expect(draftMutationsTargeting(ms, { kind: "note_receivable", id: "n1" })).toEqual(ms.slice(0, 2));
  });

  it("matches nothing for a kind with no solver mutation", () => {
    const ms: SolverMutation[] = [{ kind: "income-upsert", id: "x", value: null }];
    expect(draftMutationsTargeting(ms, { kind: "transfer", id: "x" })).toEqual([]);
  });

  it("matches nothing when the id is null", () => {
    const ms: SolverMutation[] = [{ kind: "income-upsert", id: "x", value: null }];
    expect(draftMutationsTargeting(ms, { kind: "income", id: null })).toEqual([]);
  });
});
