// src/lib/solver/__tests__/entity-flow-override-mutation.test.ts
//
// Backs the trust editor's Flows schedule grid. entity_flow_overrides is a
// scenario-PARTITIONED table (its own scenario_id column), not a scenario
// change — so this kind patches the working tree and is persisted by the
// save-scenario route (see the clone in Task 5), never by pushTechniqueUpsert.
import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { isBaseSavableMutation } from "@/lib/solver/mutations-to-base-updates";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import { mutationKey } from "@/lib/solver/types";
import type { ClientData, EntityFlowOverride } from "@/engine/types";

function tree(overrides: EntityFlowOverride[]): ClientData {
  return {
    client: {} as never,
    accounts: [], savingsRules: [], incomes: [], expenses: [], liabilities: [],
    entityFlowOverrides: overrides,
    planSettings: {} as ClientData["planSettings"],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

const row = { kind: "entity-flow-override-upsert" as const, entityId: "ent-1", year: 2030 };

describe("entity-flow-override-upsert — wire schema", () => {
  it("accepts a sparse cell", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      ...row, value: { incomeAmount: 50_000, expenseAmount: null, distributionPercent: null },
    }).success).toBe(true);
  });

  it("accepts a null value (clear the year)", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({ ...row, value: null }).success).toBe(true);
  });

  it("rejects a non-integer year", () => {
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      ...row, year: 2030.5, value: null,
    }).success).toBe(false);
  });

  it("rejects a distributionPercent typed as a whole-number percent, accepts the decimal fraction", () => {
    // The column is decimal(5,4) (max magnitude 9.9999) and the canonical
    // wire validator for this same table (flow-overrides.ts) bounds this to
    // [0, 1]. An advisor typing "50" meaning 50% must not parse clean — it
    // would land in the working tree as 5000% and overflow the column the
    // moment save-scenario persists it.
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      ...row, value: { incomeAmount: null, expenseAmount: null, distributionPercent: 50 },
    }).success).toBe(false);
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      ...row, value: { incomeAmount: null, expenseAmount: null, distributionPercent: 0.5 },
    }).success).toBe(true);
  });

  it("accepts a payload carrying only the key the advisor typed", () => {
    // Every solver route body is `z.array(SOLVER_MUTATION_SCHEMA)`, so a
    // grid cell posted with only the field it edited must not 400 the whole
    // request just because the other two keys are absent (not merely null).
    expect(SOLVER_MUTATION_SCHEMA.safeParse({
      ...row, value: { incomeAmount: 50_000 },
    }).success).toBe(true);
  });
});

describe("entity-flow-override-upsert — mutation key", () => {
  it("keys by entity AND year, so two years do not collapse into one", () => {
    expect(mutationKey({ ...row, value: null })).toBe("entity-flow-override-upsert:ent-1:2030");
    expect(mutationKey({ ...row, year: 2031, value: null }))
      .toBe("entity-flow-override-upsert:ent-1:2031");
  });
});

describe("applyMutations — entity-flow-override-upsert", () => {
  it("adds an override for a year the tree lacks", () => {
    const out = applyMutations(tree([]), [
      { ...row, value: { incomeAmount: 50_000, expenseAmount: null, distributionPercent: 0.5 } },
    ]);
    expect(out.entityFlowOverrides).toHaveLength(1);
    expect(out.entityFlowOverrides?.[0].incomeAmount).toBe(50_000);
    expect(typeof out.entityFlowOverrides?.[0].incomeAmount).toBe("number");
    // distributionPercent has the tightest DB precision (decimal(5,4)) of the
    // three cells — a string here concatenates in the engine (1 + "0.03" is
    // "10.03"), a class of bug that has shipped to prod in this repo.
    expect(typeof out.entityFlowOverrides?.[0].distributionPercent).toBe("number");
  });

  it("replaces the override for the same (entity, year)", () => {
    const existing: EntityFlowOverride = {
      entityId: "ent-1", year: 2030, incomeAmount: 10_000,
      expenseAmount: null, distributionPercent: null,
    };
    const out = applyMutations(tree([existing]), [
      { ...row, value: { incomeAmount: 50_000, expenseAmount: null, distributionPercent: null } },
    ]);
    expect(out.entityFlowOverrides).toHaveLength(1);
    expect(out.entityFlowOverrides?.[0].incomeAmount).toBe(50_000);
  });

  it("leaves a different year untouched", () => {
    const other: EntityFlowOverride = {
      entityId: "ent-1", year: 2031, incomeAmount: 10_000,
      expenseAmount: null, distributionPercent: null,
    };
    const out = applyMutations(tree([other]), [
      { ...row, value: { incomeAmount: 50_000, expenseAmount: null, distributionPercent: null } },
    ]);
    expect(out.entityFlowOverrides).toHaveLength(2);
  });

  it("removes the override when value is null", () => {
    const existing: EntityFlowOverride = {
      entityId: "ent-1", year: 2030, incomeAmount: 10_000,
      expenseAmount: null, distributionPercent: null,
    };
    const out = applyMutations(tree([existing]), [{ ...row, value: null }]);
    expect(out.entityFlowOverrides).toHaveLength(0);
  });
});

describe("entity-flow-override-upsert — persistence classification", () => {
  it("reports NOT base-savable", () => {
    expect(isBaseSavableMutation({ ...row, value: null })).toBe(false);
  });

  it("emits NO scenario change — the table is partitioned, not overlaid", () => {
    const drafts = mutationsToScenarioChanges(tree([]), "client-1", [
      { ...row, value: { incomeAmount: 1, expenseAmount: null, distributionPercent: null } },
    ]);
    expect(drafts).toHaveLength(0);
  });
});
