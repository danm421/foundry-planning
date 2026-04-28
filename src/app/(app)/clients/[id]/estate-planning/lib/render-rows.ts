import type { ClientData } from "@/engine/types";

export type TaxTreatmentTag = "DEF" | "TAX" | "FREE" | "DB";

export function taxTreatmentTag(account: {
  category: string;
  subType?: string;
}): TaxTreatmentTag | null {
  const { category, subType } = account;
  switch (category) {
    case "retirement":
      return subType === "roth_ira" || subType === "roth_401k" ? "FREE" : "DEF";
    case "taxable":
    case "cash":
      return "TAX";
    case "life_insurance":
      return "DB";
    default:
      return null;
  }
}

export interface RenderRow {
  accountId: string;
  accountName: string;
  category: string;
  taxTag: TaxTreatmentTag | null;
  ownerPercent: number;        // this owner's slice fraction
  sliceValue: number;           // account.value * ownerPercent (gross)
  /** This owner's slice of any liability whose linkedPropertyId === account.id. 0 if none. */
  linkedLiabilityBalance: number;
  /** sliceValue − linkedLiabilityBalance — the value displayed on the IN ESTATE card. */
  netSliceValue: number;
  hasMultipleOwners: boolean;
  coOwners: { label: string; percent: number }[]; // empty when sole owner
}

export interface UnlinkedLiabilityRow {
  liabilityId: string;
  liabilityName: string;
  ownerPercent: number;
  /** balance × owner.percent — expressed as a positive number; the UI prefixes with "−". */
  sliceValue: number;
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

  const sliceValue = account.value * owner.percent;
  const linkedLiabilityBalance = (tree.liabilities ?? [])
    .filter((l) => l.linkedPropertyId === account.id)
    .reduce((acc, l) => {
      const lOwner = (l.owners ?? []).find((o) =>
        ownerKind === "family_member"
          ? o.kind === "family_member" && o.familyMemberId === ownerId
          : o.kind === "entity" && o.entityId === ownerId,
      );
      return acc + (lOwner ? l.balance * lOwner.percent : 0);
    }, 0);

  return {
    accountId: account.id,
    accountName: account.name,
    category: account.category,
    taxTag: taxTreatmentTag({ category: account.category, subType: account.subType }),
    ownerPercent: owner.percent,
    sliceValue,
    linkedLiabilityBalance,
    netSliceValue: sliceValue - linkedLiabilityBalance,
    hasMultipleOwners: coOwners.length > 0,
    coOwners,
  };
}

export function unlinkedLiabilitiesForFamilyMember(
  tree: ClientData,
  familyMemberId: string,
): UnlinkedLiabilityRow[] {
  return (tree.liabilities ?? [])
    .filter((l) => !l.linkedPropertyId)
    .flatMap((l) => {
      const owner = (l.owners ?? []).find(
        (o) => o.kind === "family_member" && o.familyMemberId === familyMemberId,
      );
      if (!owner) return [];
      return [{
        liabilityId: l.id,
        liabilityName: l.name,
        ownerPercent: owner.percent,
        sliceValue: l.balance * owner.percent,
      }];
    })
    .sort((a, b) => b.sliceValue - a.sliceValue);
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
