// Engine `ClientData` → the view shapes the Estate Planning details-page
// controls expect. One file, so the whole mapping is reviewable in one place
// rather than smeared across the trust editor's six tabs.
//
// Several of these props are structurally typed, so a wrong field name here is
// a runtime `undefined`, not a compile error. Every target type below was read
// before its adapter was written.

import type { ClientData, EntitySummary, Expense, Income } from "@/engine/types";
import type {
  Entity as ViewEntity,
  ExternalBeneficiary as ViewExternalBeneficiary,
  FamilyMember as ViewFamilyMember,
} from "@/components/family-view";
import type {
  AssetsTabAccount,
  AssetsTabBusiness,
  AssetsTabExpense,
  AssetsTabFamilyMember,
  AssetsTabIncome,
  AssetsTabLiability,
} from "@/components/forms/assets-tab";
import type { FlowsTabIncome } from "@/components/forms/flows-tab";

/** Entity types the trust Assets-tab picker treats as assignable businesses.
 *  Mirrors `BUSINESS_ENTITY_TYPES` in the family page's server component —
 *  trusts and foundations are not §709-giftable business interests. */
const BUSINESS_ENTITY_TYPES = new Set([
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "other",
]);

/** Household names for `TrustEndsSelect` and `BeneficiaryRowList`. */
export function toTrustHousehold(d: ClientData): {
  client: { firstName: string };
  spouse: { firstName: string } | null;
} {
  return {
    client: { firstName: d.client.firstName },
    spouse: d.client.spouseDob ? { firstName: d.client.spouseName ?? "Co-client" } : null,
  };
}

/** `BeneficiaryRowList.members`. The view type carries CRM-only fields the list
 *  never reads (notes, dependant overrides); they are filled from the engine row
 *  where it has them and left null where it does not. */
export function toBeneficiaryMembers(d: ClientData): ViewFamilyMember[] {
  return (d.familyMembers ?? []).map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    relationship: m.relationship,
    role: m.role,
    dateOfBirth: m.dateOfBirth,
    notes: null,
    domesticPartner: m.domesticPartner,
  }));
}

/** `BeneficiaryRowList.externals`. */
export function toBeneficiaryExternals(d: ClientData): ViewExternalBeneficiary[] {
  return (d.externalBeneficiaries ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    notes: null,
  }));
}

/** `AssetsTab.accounts` — also the eligible-source list for `SellToTrustDialog`. */
export function toAssetsTabAccounts(d: ClientData): AssetsTabAccount[] {
  return d.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    value: a.value,
    subType: a.subType,
    isDefaultChecking: a.isDefaultChecking,
    owners: a.owners,
  }));
}

/** `AssetsTab.liabilities`. */
export function toAssetsTabLiabilities(d: ClientData): AssetsTabLiability[] {
  return d.liabilities.map((l) => ({
    id: l.id,
    name: l.name,
    balance: l.balance,
    owners: l.owners,
  }));
}

/** `AssetsTab.incomes` — carries the optional flow metadata so the same rows
 *  can seed the Flows tab. */
export function toAssetsTabIncomes(d: ClientData): AssetsTabIncome[] {
  return d.incomes.map((i) => ({
    id: i.id,
    name: i.name,
    annualAmount: i.annualAmount,
    cashAccountId: i.cashAccountId,
    ownerEntityId: i.ownerEntityId ?? null,
    startYear: i.startYear,
    endYear: i.endYear,
    growthRate: i.growthRate,
    inflationStartYear: i.inflationStartYear ?? null,
  }));
}

/** `AssetsTab.expenses`. */
export function toAssetsTabExpenses(d: ClientData): AssetsTabExpense[] {
  return d.expenses.map((e) => ({
    id: e.id,
    name: e.name,
    annualAmount: e.annualAmount,
    cashAccountId: e.cashAccountId,
    ownerEntityId: e.ownerEntityId ?? null,
    startYear: e.startYear,
    endYear: e.endYear,
    growthRate: e.growthRate,
    inflationStartYear: e.inflationStartYear ?? null,
  }));
}

/** `AssetsTab.businesses` — the picker's polymorphic `entity_owners` rows. */
export function toAssetsTabBusinesses(d: ClientData): AssetsTabBusiness[] {
  return (d.entities ?? [])
    .filter((e) => e.entityType != null && BUSINESS_ENTITY_TYPES.has(e.entityType))
    .map((e) => ({
      id: e.id,
      name: e.name ?? "",
      value: e.value ?? 0,
      owners: e.owners ?? [],
    }));
}

/** `AssetsTab.familyMembers`, and the `applyAssetTabOp` context that decides
 *  who absorbs ownership freed by a removal. `role` is required here but
 *  optional on the beneficiary view type, so this cannot reuse
 *  {@link toBeneficiaryMembers}. */
export function toAssetsTabFamilyMembers(d: ClientData): AssetsTabFamilyMember[] {
  return (d.familyMembers ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    firstName: m.firstName,
  }));
}

/** `AssetsTab.entities` / `BeneficiaryRowList.entities` — the id+name picker list. */
export function toEntityOptions(d: ClientData): { id: string; name: string }[] {
  return (d.entities ?? []).map((e) => ({ id: e.id, name: e.name ?? "" }));
}

/** The one entity-owned income (or expense) feeding `FlowsTab`'s annual card.
 *  Returns null when the entity has none — the tab then offers "+ Add income".
 *  `growthSource` is not an engine field: an amount anchored to an earlier
 *  inflation start year is a today's-dollars amount and grows with inflation. */
export function toFlowsTabFlow(
  rows: ReadonlyArray<Income | Expense>,
  entityId: string,
): FlowsTabIncome | null {
  const row = rows.find((r) => r.ownerEntityId === entityId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    annualAmount: row.annualAmount,
    startYear: row.startYear,
    endYear: row.endYear,
    growthRate: row.growthRate,
    growthSource: row.inflationStartYear != null ? "inflation" : "custom",
    inflationStartYear: row.inflationStartYear ?? null,
  };
}

/** `SellToTrustDialog.trust`. The dialog reads only id and name, but the prop is
 *  the details page's full `Entity` row, so every field has to be present. */
export function toViewEntity(e: EntitySummary): ViewEntity {
  return {
    id: e.id,
    name: e.name ?? "",
    entityType: e.entityType ?? "trust",
    notes: e.notes ?? null,
    includeInPortfolio: e.includeInPortfolio,
    isGrantor: e.isGrantor,
    grantorStatusEndYear: e.grantorStatusEndYear ?? null,
    value: String(e.value ?? 0),
    basis: String(e.basis ?? 0),
    owners: e.owners ?? [],
    owner: null,
    grantor: e.grantor ?? null,
    beneficiaries: null,
    trustSubType: e.trustSubType ?? null,
    isIrrevocable: e.isIrrevocable ?? null,
    trustee: e.trustee ?? null,
    trustEnds: e.trustEnds ?? null,
    distributionMode: e.distributionMode ?? null,
    distributionAmount: e.distributionAmount ?? null,
    distributionPercent: e.distributionPercent ?? null,
    taxTreatment: e.taxTreatment,
    distributionPolicyPercent: e.distributionPolicyPercent ?? null,
    flowMode: e.flowMode,
    valueGrowthRate: e.valueGrowthRate ?? null,
  };
}
