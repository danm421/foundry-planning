// src/lib/scenario/scenario-changes-to-base-writes.ts
//
// No IO: a pure function of its inputs. (It is still server-only: the
// `SCENARIO_ONLY_KINDS` import loads promote-table-registry, which pulls in
// `@/db/schema` and the promote child writers.) Translates a scenario's overlay
// (scenario_changes filtered by toggle state) into a BaseWritePlan describing
// INSERT/UPDATE/DELETE operations on the base-case rows. Cascade deletes (dropping transfers/reinvestments/etc. that
// dangled on a removed account) are taken from the engine's own
// applyScenarioChanges warnings, so we reuse the engine's cascade rules rather
// than re-deriving them here.
//
// One kind does not map to a single base table: a `gift` change can describe a
// one-time gift (`gifts`) or a recurring series (`gift_series`). The series
// half is separated out here — see `plan.giftSeries` and `GiftSeriesWrites`.
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
import { SCENARIO_ONLY_KINDS } from "./promote-table-registry";
import { isEstateFlowGiftDraft } from "./apply-gift-overlays";
import { planSettingsEngineToColumns } from "./plan-settings-fields";
import { withReinvestmentTargets } from "./reinvestment-picks";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

/** CascadeWarning.kind → the TargetKind whose base row must be deleted. The two
 *  reassign/unreference cascades change a reference rather than delete a row, so
 *  they map to null (no base delete).
 *
 *  Both equity cascades map to null because Postgres already does them: the
 *  account delete this plan emits fires `stock_option_accounts.account_id`'s
 *  ON DELETE CASCADE (taking the grants with it) and
 *  `destination_account_id`'s ON DELETE SET NULL. Emitting a base write here
 *  would be a second, redundant delete of a row that is already gone — and
 *  there is no equity TargetKind to name it with. `parent_account_cleared` is
 *  null for the same reason: `parent_account_id`'s ON DELETE SET NULL already
 *  releases a deleted business's children. */
const CASCADE_KIND_TO_TARGET: Record<CascadeWarning["kind"], TargetKind | null> = {
  transfer_dropped: "transfer",
  reinvestment_dropped: "reinvestment",
  roth_conversion_dropped: "roth_conversion",
  savings_rule_dropped: "savings_rule",
  will_bequest_dropped: "will_bequest",
  beneficiary_reassigned: null,
  external_beneficiary_unreferenced: null,
  equity_plan_dropped: null,
  equity_destination_cleared: null,
  parent_account_cleared: null,
};

/** The `EstateFlowGift` behind a `gift` add when — and only when — it is a
 *  recurring series; null for every other kind and for one-time gift drafts
 *  (which keep landing in `plan.inserts` untouched). Uses the overlay's own
 *  predicate so the classifier and the projection cannot disagree about what a
 *  draft is. */
function seriesDraft(
  targetKind: string,
  payload: unknown,
): EstateFlowGift | null {
  if (targetKind !== "gift" || !isEstateFlowGiftDraft(payload)) return null;
  return payload.kind === "series" ? payload : null;
}

export function scenarioChangesToBaseWrites(
  baseTree: ClientData,
  changes: ScenarioChange[],
  groups: ToggleGroup[],
  toggleState: ToggleState,
  /** The base load's custom account-group members (`ResolutionContext`), so the
   *  cascade below expands a reinvestment's custom groups as the scenario load does. */
  customGroupMembersById: Map<string, string[]> = new Map(),
): BaseWritePlan {
  const plan: BaseWritePlan = {
    inserts: [],
    updates: [],
    singletonUpdates: [],
    removes: [],
    giftSeries: { upserts: [], removes: [] },
  };

  // 1. Filter changes by effective toggle state (same rule the engine uses).
  const effState = resolveEffectiveToggleState(toggleState, groups);
  const active = changes.filter(
    (c) => c.toggleGroupId == null || effState[c.toggleGroupId] === true,
  );

  // 2. Map each active change.
  for (const c of active) {
    // Scenario-only kinds (the LTC stress test) never reach the base plan.
    if (SCENARIO_ONLY_KINDS.has(c.targetKind)) continue;
    if (c.opType === "add") {
      const series = seriesDraft(c.targetKind, c.payload);
      if (series) {
        // A series the advisor toggled OFF contributes nothing to the
        // scenario's numbers (`applyGiftsToClientData` skips `enabled: false`),
        // and promote's contract is "base equals what this scenario shows" —
        // for `gift_series`, absence IS off, so the partition row goes.
        if (series.enabled === false) plan.giftSeries.removes.push(c.targetId);
        else plan.giftSeries.upserts.push({ id: c.targetId, draft: series });
        // A one-time gift switched to recurring is this ONE add under the gift's
        // own id (no `remove` row), so the base `gifts` row under that id has to
        // go or it survives beside its replacement. Only when base HAS such a
        // gift, so a brand-new series plans no removal at all. `tree.gifts` is
        // cash-only; an asset gift exists only as a `giftEvents` entry, so both
        // are read.
        const baseHasGift =
          baseTree.gifts?.some((g) => g.id === c.targetId) ||
          baseTree.giftEvents?.some(
            (e) => (e as { sourceGiftId?: string }).sourceGiftId === c.targetId,
          );
        if (baseHasGift) {
          plan.removes.push({ kind: "gift", id: c.targetId, cascade: false });
        }
        continue;
      }
      // The mirror: a recurring gift switched to one-time is a one-time add on
      // the series' id. As with `remove` below, the change cannot say which
      // table the id lives in and no lookup is needed — a delete that matches
      // nothing is a harmless no-op — so the partition row under that id goes
      // or `copyGiftSeriesToBase` would carry it into base beside the new gift.
      if (c.targetKind === "gift") plan.giftSeries.removes.push(c.targetId);
      plan.inserts.push({
        kind: c.targetKind,
        targetId: c.targetId,
        raw: (c.payload ?? {}) as Record<string, unknown>,
      });
    } else if (c.opType === "remove") {
      plan.removes.push({ kind: c.targetKind, id: c.targetId, cascade: false });
      // The change cannot say which of the two gift tables the id lives in, and
      // it does not need to: deleting a series id from `gifts` (or a one-time
      // gift id from `gift_series`) matches nothing and costs one no-op
      // statement, where a DB lookup would cost a round trip AND a decision.
      if (c.targetKind === "gift") plan.giftSeries.removes.push(c.targetId);
    } else {
      // edit: payload is { field: { from, to } } — keep only `to`.
      const diff = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const set: Record<string, unknown> = {};
      for (const [field, fv] of Object.entries(diff)) set[field] = fv.to;
      if (c.targetKind === "plan_settings") {
        // Scenario edits carry ENGINE keys; the base row wants its columns.
        plan.singletonUpdates.push({ kind: c.targetKind, set: planSettingsEngineToColumns(set) });
      } else if (c.targetKind === "client") {
        plan.singletonUpdates.push({ kind: c.targetKind, set });
      } else {
        plan.updates.push({ kind: c.targetKind, id: c.targetId, set });
      }
    }
  }

  // 3. Reuse the engine to compute cascade drops, then turn each into a delete.
  // The cascade reads each reinvestment's union, which an add / edit does not
  // carry and an added account can grow, so it gets the same pre-pass the
  // scenario load runs. Only the cascade does: the writes above stay exactly
  // what the changes store, and base re-expands the groups on its next load.
  const withTargets = withReinvestmentTargets(changes, baseTree, toggleState, groups, customGroupMembersById);
  const { warnings } = applyScenarioChanges(withTargets.tree, withTargets.changes, toggleState, groups);
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

/** Every income id a promoted savings rule's percent resolves against,
 *  EXCLUDING ids satisfied by an income inserted in the same plan (those are
 *  synthetic and get remapped to their generated uuid inside the promote txn —
 *  and a `db`-scoped tenant read, which runs OUTSIDE that transaction, could
 *  not see them anyway, so asserting on them would reject a legal promotion).
 *  The savings_rule_salary_incomes.income_id FK is GLOBAL (no tenant column),
 *  so the caller must tenant-check these before executing the plan — the same
 *  guard collectExternalDedicatedAccountIds exists for. */
export function collectExternalSalaryIncomeIds(plan: BaseWritePlan): string[] {
  const insertedSyntheticIds = new Set(
    plan.inserts.filter((i) => i.kind === "income").map((i) => i.targetId),
  );
  const ids = new Set<string>();
  const add = (raw: unknown) => {
    for (const id of (raw as string[] | undefined) ?? []) {
      if (!insertedSyntheticIds.has(id)) ids.add(id);
    }
  };
  for (const ins of plan.inserts) {
    if (ins.kind === "savings_rule") add(ins.raw.salaryIncomeIds);
  }
  for (const u of plan.updates) {
    if (u.kind === "savings_rule") add(u.set.salaryIncomeIds);
  }
  return [...ids];
}
