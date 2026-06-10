// src/lib/solver/__tests__/revocable-tag-roundtrip.test.ts
//
// Persistence round-trip: a revocable-trust tag applied via
// buildRevocableTagMutations() must survive the full save → load path:
//   1. mutationsToScenarioChanges() emits an "edit" draft (not "add") whose
//      payload carries a { from, to } diff for revocableTrustName.
//   2. applyScenarioChanges() replays that draft back onto the base tree and
//      the account's revocableTrustName is "Smith Family Trust".
//
// This is the safety net for the revocable-trust solver lever (estate phase 1).

import { describe, it, expect } from "vitest";
import type { Account, ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import { buildRevocableTagMutations } from "../estate-levers";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import type { SolverScenarioChangeDraft } from "../types";

function acct(id: string): Account {
  return {
    id,
    name: id,
    category: "taxable",
    value: 250_000,
    basis: 100_000,
    revocableTrustName: null,
    owners: [],
  } as unknown as Account;
}

/** Promote a SolverScenarioChangeDraft to the ScenarioChange shape that
 *  applyScenarioChanges expects. Uses a sentinel scenarioId; toggleGroupId is
 *  null (always-active) so the toggle filter is a no-op. */
function toChange(d: SolverScenarioChangeDraft, idx: number): ScenarioChange {
  return {
    id: `chg-${idx}`,
    scenarioId: "scenario-test",
    opType: d.opType,
    targetKind: d.targetKind,
    targetId: d.targetId,
    payload: d.payload,
    toggleGroupId: null,
    orderIndex: d.orderIndex,
  };
}

describe("revocable-tag scenario round-trip", () => {
  it("persists revocableTrustName as an account edit that survives replay", () => {
    const base = acct("acct-1");
    const tree = {
      accounts: [base],
      incomes: [],
      expenses: [],
      savingsRules: [],
      client: {} as ClientData["client"],
      planSettings: {} as ClientData["planSettings"],
    } as unknown as ClientData;

    const mutations = buildRevocableTagMutations(
      [base],
      new Set(["acct-1"]),
      "Smith Family Trust",
    );

    // ── Save: mutations → structured scenario-change drafts ──────────────────
    const drafts = mutationsToScenarioChanges(tree, "client-1", mutations);
    const accountDraft = drafts.find((d) => d.targetId === "acct-1");

    // 1. The change for the existing account is an EDIT (not add/remove).
    expect(accountDraft?.opType).toBe("edit");
    expect(accountDraft?.targetKind).toBe("account");

    // 2. The diff records revocableTrustName being set to "Smith Family Trust".
    const payload = accountDraft?.payload as Record<string, { from: unknown; to: unknown }>;
    expect(payload.revocableTrustName).toBeDefined();
    expect(payload.revocableTrustName.from).toBeNull();
    expect(payload.revocableTrustName.to).toBe("Smith Family Trust");

    // ── Load/replay: structured changes → effective tree ─────────────────────
    const changes: ScenarioChange[] = drafts.map(toChange);
    const { effectiveTree } = applyScenarioChanges(
      structuredClone(tree),
      changes,
      {},   // no toggle overrides — every change is ungrouped (always active)
      [],   // no toggle groups
    );

    // 3. After replay the account carries the trust name.
    expect(effectiveTree.accounts[0].revocableTrustName).toBe("Smith Family Trust");
  });
});
