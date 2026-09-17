// What an asset-transaction sell leg is allowed to point at, and what a
// business sale actually disposes of.
//
// The engine sells a business through `applyBusinessSales` (engine/asset-
// transactions.ts): it sells the business' own operating value AND cascades
// through every account and liability whose `parentAccountId` points at it.
// A sale that points at the business through the plain `accountId` field goes
// down `applyAssetSales` instead and sells the shell alone — leaving the
// company's property and cash behind. So a top-level business must never be
// offered as a plain account source; it is offered as a business, and the
// picker writes `businessAccountId`.

import type { Account, Liability } from "@/engine/types";

// ── Types ────────────────────────────────────────────────────────────────────

/** The account shape the sell pickers need. Every field past the identity four
 *  is optional so a caller that has not wired it up yet still compiles — it
 *  just loses the corresponding filter or hint. */
export interface SellSourceAccount {
  id: string;
  name: string;
  category: string;
  subType: string;
  /** Controlling family-member id when 100% owned by a single person. */
  ownerFamilyMemberId?: string | null;
  /** Current balance-sheet value, shown beside the name in the sell picker. */
  value?: number;
  /** Auto-provisioned cash bucket of a business or trust. */
  isDefaultChecking?: boolean;
  /** Parent business account id, when this account sits inside a business. */
  parentAccountId?: string | null;
  /** True when a trust or other entity holds an ownership slice. */
  isEntityOwned?: boolean;
}

export interface BusinessSaleOption {
  id: string;
  name: string;
  /** Display label for the business type (e.g. "LLC", "S-Corp"). */
  businessTypeLabel: string;
  /** The business' own operating value — goodwill and enterprise value, NOT
   *  the accounts it holds. Those are `childAccounts`. */
  value: number;
  basis: number;
  owners: Array<{
    familyMemberId: string;
    familyMemberName: string;
    percent: number;
  }>;
  /** Child accounts (accounts.parentAccountId === business.id). */
  childAccounts: Array<{
    id: string;
    name: string;
    currentValue: number;
  }>;
  /** Child liabilities (liabilities.parentAccountId === business.id). */
  childLiabilities: Array<{
    id: string;
    name: string;
    currentBalance: number;
  }>;
}

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  sole_prop: "Sole prop",
  partnership: "Partnership",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  llc: "LLC",
  other: "Other",
};

// ── Predicates ───────────────────────────────────────────────────────────────

/** A top-level business account — the row `businessAccountId` points at. */
export function isTopLevelBusiness(a: Pick<SellSourceAccount, "category" | "parentAccountId">): boolean {
  return a.category === "business" && a.parentAccountId == null;
}

/** The cash bucket the app auto-provisions for a business or a trust. It is
 *  that entity's operating account, not a holding anyone sells: a business'
 *  cash leaves with the business, and a trust's cash is the trust's. Selling
 *  one on its own drains the entity's plumbing, so it is never offered. */
export function isLockedEntityCash(a: SellSourceAccount): boolean {
  if (a.isDefaultChecking !== true) return false;
  return a.parentAccountId != null || a.isEntityOwned === true;
}

/** The accounts a sell leg may point at directly. */
export function sellableAccounts<T extends SellSourceAccount>(accounts: T[]): T[] {
  return accounts.filter((a) => !isLockedEntityCash(a) && !isTopLevelBusiness(a));
}

// ── Totals ───────────────────────────────────────────────────────────────────

/** The accounts the business owns, which the cascade sells alongside it. */
export function businessChildAssetValue(b: BusinessSaleOption): number {
  return b.childAccounts.reduce((sum, a) => sum + a.currentValue, 0);
}

/** Everything a full sale of this business liquidates: its operating value
 *  plus every account it owns. */
export function businessTotalAssetValue(b: BusinessSaleOption): number {
  return b.value + businessChildAssetValue(b);
}

/** The debt the cascade settles out of the proceeds. */
export function businessTotalDebt(b: BusinessSaleOption): number {
  return b.childLiabilities.reduce((sum, l) => sum + l.currentBalance, 0);
}

// ── Builder ──────────────────────────────────────────────────────────────────

/** Build the sellable-business list from an engine tree. `familyMemberName`
 *  resolves an owner id to a display name; unknown ids fall back to the id so
 *  the row still renders. */
export function buildBusinessSaleOptions(
  accounts: Account[],
  liabilities: Liability[],
  familyMemberName: (familyMemberId: string) => string,
): BusinessSaleOption[] {
  return accounts.filter(isTopLevelBusiness).map((b) => ({
    id: b.id,
    name: b.name,
    businessTypeLabel: BUSINESS_TYPE_LABELS[b.businessType ?? "other"] ?? "Business",
    value: Number(b.value ?? 0),
    basis: Number(b.basis ?? 0),
    owners: (b.owners ?? [])
      .filter((o) => o.kind === "family_member")
      .map((o) => ({
        familyMemberId: o.familyMemberId,
        familyMemberName: familyMemberName(o.familyMemberId),
        percent: o.percent,
      })),
    childAccounts: accounts
      .filter((a) => a.parentAccountId === b.id)
      .map((a) => ({ id: a.id, name: a.name, currentValue: Number(a.value ?? 0) })),
    childLiabilities: liabilities
      .filter((l) => l.parentAccountId === b.id)
      .map((l) => ({ id: l.id, name: l.name, currentBalance: Number(l.balance ?? 0) })),
  }));
}
