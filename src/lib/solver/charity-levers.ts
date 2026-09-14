// src/lib/solver/charity-levers.ts
//
// Removing a charity (an `external_beneficiary`) from the solver's estate
// dialog. Framework-free: engine TYPES only, no Next and no DB.

import type { ClientData, EntitySummary } from "@/engine/types";
import type { SolverMutation } from "./types";
import {
  buildGiftClearMutations,
  buildWillReferenceClearMutations,
} from "./trust-levers";

/**
 * Remove a charity and every reference to it, then delete the row.
 *
 * Removing the row alone is not enough, and the failure is not cosmetic: a
 * `BeneficiaryRef.externalBeneficiaryId` left dangling makes the LIVE preview
 * and the SAVED scenario disagree about where an asset goes at death. The death
 * event pays the designation out of the household whether or not the
 * beneficiary still exists (`death-event/shared.ts:639-643` sets `removed = true`
 * on any `externalBeneficiaryId`), while a reloaded scenario drops the reference
 * in `cascadeResolution.ts:305-372` and falls back to the estate. Two different
 * estates from one advisor action.
 *
 * The four reference classes the spec mandates for the structurally identical
 * trust case are swept here, plus planned gifts:
 *
 *   • account beneficiary designations        `BeneficiaryRef.externalBeneficiaryId`
 *   • an entity's beneficiary lists           `beneficiaries` / `remainderBeneficiaries`
 *                                             / `incomeBeneficiaries`
 *   • will bequest recipients                 `recipientKind === "external_beneficiary"`
 *   • will residuary recipients               same shape, separate array
 *   • planned gifts aimed at the charity      cash rows and asset/series events
 *
 * The will and gift sweeps are the very ones `buildDissolveTrustMutations` runs,
 * called with an `external_beneficiary` target — a second copy of the
 * emptied-bequest rule would drift.
 *
 * Ownership is deliberately NOT swept. A charity is never an owner of record;
 * an asset gifted to one is titled with a `gifted_away` slice whose recipient id
 * the engine only merges and sorts on (`ownership.ts:309-312`), and which weighs
 * zero in every estate aggregation either way. There is also no "grantor" on a
 * charity to return a slice to, so any destination would be invented.
 *
 * The delete is emitted LAST, so no intermediate tree holds a row pointing at a
 * charity that is already gone.
 */
export function buildRemoveCharityMutations(
  tree: ClientData,
  beneficiaryId: string,
): SolverMutation[] {
  const muts: SolverMutation[] = [];

  // 1. Account beneficiary designations.
  for (const a of tree.accounts) {
    const bens = a.beneficiaries ?? [];
    const kept = bens.filter((b) => b.externalBeneficiaryId !== beneficiaryId);
    if (kept.length === bens.length) continue;
    muts.push({ kind: "account-upsert", id: a.id, value: { ...a, beneficiaries: kept } });
  }

  // 2. An entity's three beneficiary lists. One merged upsert per entity: the
  //    working set is a keyed Map, so a second `entity-upsert` for the same id
  //    REPLACES the first rather than composing with it.
  for (const e of tree.entities ?? []) {
    const next: EntitySummary = { ...e };
    let changed = false;
    const bens = (e.beneficiaries ?? []).filter(
      (b) => b.externalBeneficiaryId !== beneficiaryId,
    );
    if (bens.length !== (e.beneficiaries ?? []).length) {
      next.beneficiaries = bens;
      changed = true;
    }
    const remainder = (e.remainderBeneficiaries ?? []).filter(
      (r) => r.externalBeneficiaryId !== beneficiaryId,
    );
    if (remainder.length !== (e.remainderBeneficiaries ?? []).length) {
      next.remainderBeneficiaries = remainder;
      changed = true;
    }
    const income = (e.incomeBeneficiaries ?? []).filter(
      (r) => r.externalBeneficiaryId !== beneficiaryId,
    );
    if (income.length !== (e.incomeBeneficiaries ?? []).length) {
      next.incomeBeneficiaries = income;
      changed = true;
    }
    if (changed) muts.push({ kind: "entity-upsert", id: e.id, value: next });
  }

  // 3. Planned gifts, then 4. wills — both shared with the dissolve lever.
  const target = { kind: "external_beneficiary", id: beneficiaryId } as const;
  muts.push(...buildGiftClearMutations(tree, target));
  muts.push(...buildWillReferenceClearMutations(tree, target));

  // 5. The charity itself — always last.
  muts.push({ kind: "external-beneficiary-upsert", id: beneficiaryId, value: null });
  return muts;
}
