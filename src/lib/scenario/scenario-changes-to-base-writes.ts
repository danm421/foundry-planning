// src/lib/scenario/scenario-changes-to-base-writes.ts
//
// PURE. Translates a scenario's overlay (scenario_changes filtered by toggle
// state) into a BaseWritePlan describing INSERT/UPDATE/DELETE operations on the
// base-case rows. Cascade deletes (dropping transfers/reinvestments/etc. that
// dangled on a removed account) are taken from the engine's own
// applyScenarioChanges warnings, so we reuse the engine's cascade rules rather
// than re-deriving them here.
import type { ClientData } from "@/engine/types";
import {
  applyScenarioChanges,
  resolveEffectiveToggleState,
} from "@/engine/scenario/applyChanges";
import type {
  ScenarioChange,
  ToggleGroup,
  ToggleState,
  CascadeWarning,
  TargetKind,
} from "@/engine/scenario/types";
import type { BaseWritePlan } from "./promote-to-base-types";

/** CascadeWarning.kind → the TargetKind whose base row must be deleted. The two
 *  reassign/unreference cascades change a reference rather than delete a row, so
 *  they map to null (no base delete). */
const CASCADE_KIND_TO_TARGET: Record<CascadeWarning["kind"], TargetKind | null> = {
  transfer_dropped: "transfer",
  reinvestment_dropped: "reinvestment",
  roth_conversion_dropped: "roth_conversion",
  savings_rule_dropped: "savings_rule",
  will_bequest_dropped: "will_bequest",
  beneficiary_reassigned: null,
  external_beneficiary_unreferenced: null,
};

export function scenarioChangesToBaseWrites(
  baseTree: ClientData,
  changes: ScenarioChange[],
  groups: ToggleGroup[],
  toggleState: ToggleState,
): BaseWritePlan {
  const plan: BaseWritePlan = {
    inserts: [],
    updates: [],
    singletonUpdates: [],
    removes: [],
  };

  // 1. Filter changes by effective toggle state (same rule the engine uses).
  const effState = resolveEffectiveToggleState(toggleState, groups);
  const active = changes.filter(
    (c) => c.toggleGroupId == null || effState[c.toggleGroupId] === true,
  );

  // 2. Map each active change.
  for (const c of active) {
    if (c.opType === "add") {
      plan.inserts.push({
        kind: c.targetKind,
        targetId: c.targetId,
        raw: (c.payload ?? {}) as Record<string, unknown>,
      });
    } else if (c.opType === "remove") {
      plan.removes.push({ kind: c.targetKind, id: c.targetId, cascade: false });
    } else {
      // edit: payload is { field: { from, to } } — keep only `to`.
      const diff = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const set: Record<string, unknown> = {};
      for (const [field, fv] of Object.entries(diff)) set[field] = fv.to;
      if (c.targetKind === "client" || c.targetKind === "plan_settings") {
        plan.singletonUpdates.push({ kind: c.targetKind, set });
      } else {
        plan.updates.push({ kind: c.targetKind, id: c.targetId, set });
      }
    }
  }

  // 3. Reuse the engine to compute cascade drops, then turn each into a delete.
  const { warnings } = applyScenarioChanges(baseTree, changes, toggleState, groups);
  for (const w of warnings) {
    const kind = CASCADE_KIND_TO_TARGET[w.kind];
    if (!kind) continue;
    plan.removes.push({ kind, id: w.affectedEntityId, cascade: true });
  }

  return plan;
}

/** Every dedicated-account id an education expense in the plan draws from,
 *  EXCLUDING ids satisfied by an account inserted in the same plan (those are
 *  synthetic and get remapped to their generated uuid inside the promote txn).
 *  The expense_dedicated_accounts.account_id FK is GLOBAL (no tenant column),
 *  so the caller must tenant-check these before executing the plan — same
 *  guard save-to-base runs. */
export function collectExternalDedicatedAccountIds(plan: BaseWritePlan): string[] {
  const insertedSyntheticIds = new Set(
    plan.inserts.filter((i) => i.kind === "account").map((i) => i.targetId),
  );
  const ids = new Set<string>();
  for (const ins of plan.inserts) {
    if (ins.kind !== "expense") continue;
    for (const aid of (ins.raw.dedicatedAccountIds as string[] | undefined) ?? []) {
      if (!insertedSyntheticIds.has(aid)) ids.add(aid);
    }
  }
  for (const u of plan.updates) {
    if (u.kind !== "expense") continue;
    for (const aid of (u.set.dedicatedAccountIds as string[] | undefined) ?? []) {
      if (!insertedSyntheticIds.has(aid)) ids.add(aid);
    }
  }
  return [...ids];
}
