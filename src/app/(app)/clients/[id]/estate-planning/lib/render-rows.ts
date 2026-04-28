import type { ClientData } from "@/engine/types";
import { taxTreatmentTag, type TaxTreatmentTag } from "./derive-card-data";

export type { TaxTreatmentTag };

export interface RenderRow {
  accountId: string;
  accountName: string;
  category: string;
  taxTag: TaxTreatmentTag | null;
  ownerPercent: number;        // this owner's slice fraction
  sliceValue: number;           // account.value * ownerPercent
  hasMultipleOwners: boolean;
  coOwners: { label: string; percent: number }[]; // empty when sole owner
}

export function rowsForFamilyMember(tree: ClientData, familyMemberId: string): RenderRow[] {
  return tree.accounts
    .filter((a) => a.owners?.some((o) => o.kind === "family_member" && o.familyMemberId === familyMemberId))
    .map((a) => buildRow(tree, a, "family_member", familyMemberId))
    .filter((r): r is RenderRow => r !== null)
    .sort(compareRows);
}

export function rowsForEntity(tree: ClientData, entityId: string): RenderRow[] {
  return tree.accounts
    .filter((a) => a.owners?.some((o) => o.kind === "entity" && o.entityId === entityId))
    .map((a) => buildRow(tree, a, "entity", entityId))
    .filter((r): r is RenderRow => r !== null)
    .sort(compareRows);
}

function buildRow(
  tree: ClientData,
  account: ClientData["accounts"][number],
  ownerKind: "family_member" | "entity",
  ownerId: string,
): RenderRow | null {
  const owner = (account.owners ?? []).find((o) =>
    ownerKind === "family_member"
      ? o.kind === "family_member" && o.familyMemberId === ownerId
      : o.kind === "entity" && o.entityId === ownerId,
  );
  if (!owner) return null;

  const coOwners = (account.owners ?? [])
    .filter((o) => o !== owner)
    .map((o) => ({ label: ownerLabel(tree, o), percent: o.percent }));

  return {
    accountId: account.id,
    accountName: account.name,
    category: account.category,
    taxTag: taxTreatmentTag({ category: account.category, subType: account.subType }),
    ownerPercent: owner.percent,
    sliceValue: account.value * owner.percent,
    hasMultipleOwners: coOwners.length > 0,
    coOwners,
  };
}

function ownerLabel(
  tree: ClientData,
  owner: ClientData["accounts"][number]["owners"][number],
): string {
  if (owner.kind === "family_member") {
    const fm = (tree.familyMembers ?? []).find((f) => f.id === owner.familyMemberId);
    return fm?.firstName ?? "Family member";
  }
  const ent = (tree.entities ?? []).find((e) => e.id === owner.entityId);
  return ent?.name ?? "Entity";
}

function compareRows(a: RenderRow, b: RenderRow): number {
  if (a.category !== b.category) return a.category.localeCompare(b.category);
  const aTag = a.taxTag ?? "";
  const bTag = b.taxTag ?? "";
  if (aTag !== bTag) return aTag.localeCompare(bTag);
  if (b.sliceValue !== a.sliceValue) return b.sliceValue - a.sliceValue;
  // Final tiebreak: accountId for stable deterministic sort.
  return a.accountId.localeCompare(b.accountId);
}
