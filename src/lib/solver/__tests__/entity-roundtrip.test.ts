// src/lib/solver/__tests__/entity-roundtrip.test.ts
//
// Persistence round-trip: a solver-created trust (entity-upsert / add) and a
// funding retitle of an existing account (account-upsert / edit) must survive
// the full save → reload path:
//   1. mutationsToScenarioChanges() emits an "add" draft for the new entity and
//      an "edit" draft for the account whose owners change.
//   2. The entity draft's orderIndex must be lower than the account draft's so
//      applyScenarioChanges() processes the entity before the ownership change.
//   3. applyScenarioChanges() replays both drafts back onto the base tree:
//      - the new entity appears in effectiveTree.entities
//      - the account's owners reflect the entity ownership
//
// This is the safety net for the trust-creation / funding lever (estate phase 3a).

import { describe, it, expect } from "vitest";
import type { Account, ClientData, EntitySummary } from "@/engine/types";
import type { TargetKind, ScenarioChange } from "@/engine/scenario/types";
import type { SolverMutation } from "../types";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";

function tree(): ClientData {
  return {
    client: { dateOfBirth: "1960-01-01", retirementAge: 65, lifeExpectancy: 90 },
    planSettings: { planStartYear: 2026, planEndYear: 2060, inflationRate: 0.025 },
    accounts: [
      {
        id: "acct-1",
        name: "Brokerage",
        category: "taxable",
        value: 500_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
      },
    ],
    incomes: [],
    expenses: [],
    savingsRules: [],
    liabilities: [],
    entities: [],
    externalBeneficiaries: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [],
    familyMembers: [
      { id: "fm-client", role: "client", firstName: "Pat", dateOfBirth: "1960-01-01" },
    ],
  } as unknown as ClientData;
}

const idgt: EntitySummary = {
  id: "trust-idgt",
  name: "IDGT",
  entityType: "trust",
  isIrrevocable: true,
  isGrantor: true,
  includeInPortfolio: false,
  grantor: "client",
  trustSubType: "idgt",
};

describe("entity + funding-retitle round-trip (live ≡ reload)", () => {
  it("a solver-created trust and an account retitle survive replay, entity first", () => {
    const base = tree();

    const retitled: Account = {
      ...base.accounts[0],
      owners: [{ kind: "entity", entityId: "trust-idgt", percent: 1 }],
    };

    const muts: SolverMutation[] = [
      { kind: "entity-upsert", id: "trust-idgt", value: idgt },
      { kind: "account-upsert", id: "acct-1", value: retitled },
    ];

    // ── Save: mutations → structured scenario-change drafts ──────────────────
    const drafts = mutationsToScenarioChanges(base, "client-1", muts);

    const entityDraft = drafts.find((d) => d.targetId === "trust-idgt");
    const acctDraft = drafts.find((d) => d.targetId === "acct-1");

    // 1. The entity draft is an ADD (not in base.entities).
    expect(entityDraft?.opType).toBe("add");
    expect(entityDraft?.targetKind).toBe("entity");

    // 2. The account draft is an EDIT (acct-1 exists in the base tree).
    expect(acctDraft?.opType).toBe("edit");
    expect(acctDraft?.targetKind).toBe("account");

    // 3. Entity add must be ordered before the account edit so the entity
    //    exists when ownership resolution runs.
    expect(entityDraft!.orderIndex).toBeLessThan(acctDraft!.orderIndex);

    // ── Load/replay: structured changes → effective tree ─────────────────────
    // Mapping mirrors gift-roundtrip.test.ts (Phase 2 canonical pattern).
    const changes: ScenarioChange[] = drafts.map((d, i) => ({
      id: `c${i}`,
      scenarioId: "s1",
      opType: d.opType,
      // SolverScenarioChangeDraft.targetKind is a superset of TargetKind;
      // "entity" and "account" are both valid members — cast documents this.
      targetKind: d.targetKind as TargetKind,
      targetId: d.targetId,
      payload: d.payload,
      toggleGroupId: null,
      orderIndex: d.orderIndex,
    }));

    // applyScenarioChanges call shape mirrors revocable-tag-roundtrip.test.ts:
    //   (base tree, changes, {}, [])
    const { effectiveTree } = applyScenarioChanges(
      structuredClone(base),
      changes,
      {}, // no toggle overrides — all changes are ungrouped (always active)
      [], // no toggle groups
    );

    // 4. The new entity is present in the reloaded tree.
    expect(effectiveTree.entities?.some((e) => e.id === "trust-idgt")).toBe(true);

    // 5. The account's owners reflect the entity retitle (not the original family_member).
    const acct = effectiveTree.accounts.find((a) => a.id === "acct-1")!;
    expect(acct.owners).toEqual([{ kind: "entity", entityId: "trust-idgt", percent: 1 }]);
  });
});
