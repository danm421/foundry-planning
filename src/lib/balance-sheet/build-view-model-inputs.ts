// src/lib/balance-sheet/build-view-model-inputs.ts
import type { ClientData, FamilyMember } from "@/engine/types";
import type { AccountLike, LiabilityLike, EntityInfo } from "@/components/balance-sheet-report/view-model";
import type { AccountOwner } from "@/engine/ownership";

/** A note receivable reduced to what the household table needs. */
export interface NoteLike {
  id: string;
  name: string;
  owners: AccountOwner[];
}

export interface ViewModelInputs {
  accounts: AccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  familyMembers: FamilyMember[];
  notesReceivable: NoteLike[];
}

/** Map an engine `ClientData` tree to the inputs shared by `buildViewModel`
 *  and `buildHouseholdColumns`. Pure; no DB access. */
export function buildViewModelInputs(tree: ClientData): ViewModelInputs {
  const accounts: AccountLike[] = (tree.accounts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    category: a.category,
    owners: a.owners ?? [],
    parentAccountId: a.parentAccountId ?? null,
    businessType: a.businessType ?? null,
  }));
  const liabilities: LiabilityLike[] = (tree.liabilities ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    owners: l.owners ?? [],
    linkedPropertyId: l.linkedPropertyId ?? null,
    parentAccountId: l.parentAccountId ?? null,
  }));
  const entities: EntityInfo[] = (tree.entities ?? []).map((e) => ({
    id: e.id,
    name: e.name ?? "Entity",
    entityType: e.entityType ?? "trust",
    isIrrevocable: e.isIrrevocable,
    value: e.value,
    valueGrowthRate: e.valueGrowthRate,
    owners: e.owners,
  }));
  const notesReceivable: NoteLike[] = (tree.notesReceivable ?? []).map((n) => ({
    id: n.id,
    name: n.name,
    owners: n.owners ?? [],
  }));
  return { accounts, liabilities, entities, familyMembers: tree.familyMembers ?? [], notesReceivable };
}
