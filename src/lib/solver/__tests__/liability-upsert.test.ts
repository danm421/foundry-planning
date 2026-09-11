// src/lib/solver/__tests__/liability-upsert.test.ts
//
// `liability-upsert` backs the trust editor's Assets tab, where a mortgage can
// be retitled into or out of a trust. Like every upsert kind it has to survive
// the wire schema, the working-tree apply, and the save-as-scenario mapper —
// and it must report NOT base-savable, or Save-to-base drops it silently.
import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { isBaseSavableMutation } from "@/lib/solver/mutations-to-base-updates";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import { mutationKey } from "@/lib/solver/types";
import type { ClientData, Liability } from "@/engine/types";

const mortgage: Liability = {
  id: "liab-1",
  name: "Rental mortgage",
  balance: 250_000,
  interestRate: 0.0625,
  monthlyPayment: 1_800,
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  extraPayments: [],
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

function tree(liabilities: Liability[]): ClientData {
  return {
    client: {} as never,
    accounts: [],
    savingsRules: [],
    incomes: [],
    expenses: [],
    liabilities,
    planSettings: {} as ClientData["planSettings"],
    withdrawalStrategy: [],
  } as unknown as ClientData;
}

describe("liability-upsert — wire schema", () => {
  it("accepts a household mortgage", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({
        kind: "liability-upsert", id: mortgage.id, value: mortgage,
      }).success,
    ).toBe(true);
  });

  it("accepts a null value (remove)", () => {
    expect(
      SOLVER_MUTATION_SCHEMA.safeParse({
        kind: "liability-upsert", id: mortgage.id, value: null,
      }).success,
    ).toBe(true);
  });

  it("keeps an entity owner, which is how a trust holds a mortgage", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "liability-upsert",
      id: mortgage.id,
      value: { ...mortgage, owners: [{ kind: "entity", entityId: "ent-1", percent: 1 }] },
    });
    expect(r.success).toBe(true);
    // The schema must not strip owners — retitling IS the mutation.
    const parsed = r.success && r.data.kind === "liability-upsert" ? r.data.value : null;
    expect(parsed?.owners[0]).toEqual({ kind: "entity", entityId: "ent-1", percent: 1 });
  });

  it("accepts an overpaid credit card's negative balance", () => {
    // Plaid writes `balances.current` straight through with no clamp
    // (plaid/liabilities-refresh.ts:46), so an overpaid card lands as a real
    // row with a credit balance. `MONEY` (min 0) would reject it — and every
    // solver route wraps this in `z.array(SOLVER_MUTATION_SCHEMA)`, so one
    // rejected element 400s the WHOLE request, stopping the recompute
    // entirely rather than dropping that one row. The base liability POST
    // path (schemas/liabilities.ts:93) has no lower bound either.
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "liability-upsert",
      id: mortgage.id,
      value: { ...mortgage, liabilityType: "credit_card", termMonths: 0, balance: -312.4 },
    });
    expect(r.success).toBe(true);
    const parsed = r.success && r.data.kind === "liability-upsert" ? r.data.value : null;
    expect(parsed?.balance).toBe(-312.4);
  });

  it("keeps an external_beneficiary owner and a gifted_away owner", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "liability-upsert",
      id: mortgage.id,
      value: {
        ...mortgage,
        owners: [
          { kind: "external_beneficiary", externalBeneficiaryId: "eb-1", percent: 0.5 },
          { kind: "gifted_away", recipient: { kind: "entity", id: "ent-9" }, percent: 0.5 },
        ],
      },
    });
    expect(r.success).toBe(true);
    const parsed = r.success && r.data.kind === "liability-upsert" ? r.data.value : null;
    expect(parsed?.owners).toEqual([
      { kind: "external_beneficiary", externalBeneficiaryId: "eb-1", percent: 0.5 },
      { kind: "gifted_away", recipient: { kind: "entity", id: "ent-9" }, percent: 0.5 },
    ]);
  });
});

describe("liability-upsert — mutation key", () => {
  it("keys by row id so re-editing replaces rather than stacks", () => {
    expect(mutationKey({ kind: "liability-upsert", id: "liab-1", value: mortgage }))
      .toBe("liability-upsert:liab-1");
  });
});

describe("applyMutations — liability-upsert", () => {
  it("adds a liability to the working tree", () => {
    const out = applyMutations(tree([]), [
      { kind: "liability-upsert", id: mortgage.id, value: mortgage },
    ]);
    expect(out.liabilities).toHaveLength(1);
  });

  it("replaces an existing liability by id", () => {
    const out = applyMutations(tree([mortgage]), [
      { kind: "liability-upsert", id: mortgage.id, value: { ...mortgage, balance: 200_000 } },
    ]);
    expect(out.liabilities).toHaveLength(1);
    expect(out.liabilities[0].balance).toBe(200_000);
    expect(typeof out.liabilities[0].balance).toBe("number");
  });

  it("removes a liability when value is null", () => {
    const out = applyMutations(tree([mortgage]), [
      { kind: "liability-upsert", id: mortgage.id, value: null },
    ]);
    expect(out.liabilities).toHaveLength(0);
  });
});

describe("liability-upsert — base savability", () => {
  it("reports NOT base-savable, so Save-to-base cannot silently drop it", () => {
    expect(isBaseSavableMutation({
      kind: "liability-upsert", id: mortgage.id, value: mortgage,
    })).toBe(false);
  });
});

describe("mutationsToScenarioChanges — liability-upsert", () => {
  it("writes an `add` change for a liability the source tree lacks", () => {
    const drafts = mutationsToScenarioChanges(tree([]), "client-1", [
      { kind: "liability-upsert", id: mortgage.id, value: mortgage },
    ]);
    const change = drafts.find((d) => d.targetKind === "liability");
    expect(change?.opType).toBe("add");
    expect(change?.targetId).toBe("liab-1");
  });

  it("writes an `edit` change for a liability that already exists in base", () => {
    const drafts = mutationsToScenarioChanges(tree([mortgage]), "client-1", [
      { kind: "liability-upsert", id: mortgage.id, value: { ...mortgage, balance: 200_000 } },
    ]);
    const change = drafts.find((d) => d.targetKind === "liability");
    expect(change?.opType).toBe("edit");
  });

  it("writes a `remove` change for a null value against an existing row", () => {
    const drafts = mutationsToScenarioChanges(tree([mortgage]), "client-1", [
      { kind: "liability-upsert", id: mortgage.id, value: null },
    ]);
    expect(drafts.find((d) => d.targetKind === "liability")?.opType).toBe("remove");
  });
});
