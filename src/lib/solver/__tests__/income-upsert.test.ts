// src/lib/solver/__tests__/income-upsert.test.ts
//
// `income-upsert` is the mutation behind the solver's "Add income or expense"
// popup. It has to survive four independent layers — the wire schema, the
// working-tree apply, the save-as-scenario mapper, and the save-to-base
// classifier — so each gets its own assertion here. Miss one and the added
// income either 400s the recompute or silently fails to persist.
import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationsToBaseUpdates } from "@/lib/solver/mutations-to-base-updates";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import { mutationKey } from "@/lib/solver/types";
import type { ClientData, Income } from "@/engine/types";

const rental: Income = {
  id: "inc-new",
  type: "other",
  name: "Rental income",
  annualAmount: 24_000,
  startYear: 2026,
  endYear: 2050,
  growthRate: 0.03,
  growthSource: "inflation",
  startYearRef: null,
  endYearRef: "plan_end",
  owner: "client",
  taxType: "ordinary_income",
  source: "manual",
};

/** Minimal ClientData. applyMutations runs post-processing (premium-gift
 *  synthesis + resolveRefYears) after the mutation loop regardless of kind, so
 *  the unrelated collections must exist — same convention as the sibling
 *  apply-mutations-*-upsert fixtures. */
function tree(incomes: Income[]): ClientData {
  return {
    client: {} as never,
    accounts: [],
    savingsRules: [],
    incomes,
    expenses: [],
    planSettings: {} as ClientData["planSettings"],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

describe("income-upsert — wire schema", () => {
  it("accepts a household income stream", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "income-upsert",
      id: rental.id,
      value: rental,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a null value (remove)", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "income-upsert",
      id: rental.id,
      value: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an income type the engine does not know", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "income-upsert",
      id: rental.id,
      value: { ...rental, type: "nope" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an owner outside the household enum", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "income-upsert",
      id: rental.id,
      value: { ...rental, owner: "entity" },
    });
    expect(r.success).toBe(false);
  });
});

describe("income-upsert — mutation key", () => {
  it("keys by row id, so re-editing one row replaces rather than stacks", () => {
    expect(mutationKey({ kind: "income-upsert", id: "inc-new", value: rental })).toBe(
      "income-upsert:inc-new",
    );
    expect(mutationKey({ kind: "income-upsert", id: "inc-new", value: null })).toBe(
      "income-upsert:inc-new",
    );
  });
});

describe("applyMutations — income-upsert", () => {
  it("adds a new income to the working tree", () => {
    const out = applyMutations(tree([]), [
      { kind: "income-upsert", id: rental.id, value: rental },
    ]);
    expect(out.incomes).toHaveLength(1);
    expect(out.incomes[0].name).toBe("Rental income");
  });

  it("replaces an existing income by id", () => {
    const out = applyMutations(tree([rental]), [
      { kind: "income-upsert", id: rental.id, value: { ...rental, annualAmount: 30_000 } },
    ]);
    expect(out.incomes).toHaveLength(1);
    expect(out.incomes[0].annualAmount).toBe(30_000);
  });

  it("removes an income when value is null", () => {
    const out = applyMutations(tree([rental]), [
      { kind: "income-upsert", id: rental.id, value: null },
    ]);
    expect(out.incomes).toHaveLength(0);
  });
});

describe("mutationsToBaseUpdates — income-upsert", () => {
  it("classifies a row absent from base as an insert", () => {
    const out = mutationsToBaseUpdates(tree([]), [
      { kind: "income-upsert", id: rental.id, value: rental },
    ]);
    expect(out.incomeInserts.map((i) => i.id)).toContain("inc-new");
    expect(out.incomeFullUpdates).toHaveLength(0);
  });

  it("classifies a row already in base as a full update", () => {
    const out = mutationsToBaseUpdates(tree([rental]), [
      { kind: "income-upsert", id: rental.id, value: { ...rental, annualAmount: 30_000 } },
    ]);
    expect(out.incomeFullUpdates.map((i) => i.id)).toContain("inc-new");
    expect(out.incomeInserts).toHaveLength(0);
  });

  it("classifies a null value against an existing row as a remove", () => {
    const out = mutationsToBaseUpdates(tree([rental]), [
      { kind: "income-upsert", id: rental.id, value: null },
    ]);
    expect(out.incomeRemoves).toContain("inc-new");
  });

  it("drops a remove of a row base never had, rather than emitting an orphan delete", () => {
    const out = mutationsToBaseUpdates(tree([]), [
      { kind: "income-upsert", id: rental.id, value: null },
    ]);
    expect(out.incomeRemoves).toHaveLength(0);
  });

  it("is base-savable — Save to base must not silently drop it", () => {
    const out = mutationsToBaseUpdates(tree([]), [
      { kind: "income-upsert", id: rental.id, value: rental },
    ]);
    // The guard that matters: an added income reaches SOME write bucket.
    expect(
      out.incomeInserts.length + out.incomeFullUpdates.length + out.incomeRemoves.length,
    ).toBeGreaterThan(0);
  });
});

describe("mutationsToScenarioChanges — income-upsert", () => {
  it("writes an income `add` change for a row the source tree lacks", () => {
    const drafts = mutationsToScenarioChanges(tree([]), "client-1", [
      { kind: "income-upsert", id: rental.id, value: rental },
    ]);
    const change = drafts.find((d) => d.targetKind === "income");
    expect(change?.opType).toBe("add");
    expect(change?.targetId).toBe("inc-new");
  });

  it("writes a `remove` change for a null value against an existing row", () => {
    const drafts = mutationsToScenarioChanges(tree([rental]), "client-1", [
      { kind: "income-upsert", id: rental.id, value: null },
    ]);
    const change = drafts.find((d) => d.targetKind === "income");
    expect(change?.opType).toBe("remove");
  });
});
