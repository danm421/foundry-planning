import type { PlaidCommitDecision, PlaidMappedAccount } from "@contracts";
import { mapPlaidToFoundry, mapPlaidToLiability } from "@/plaid/account-mapping";

export type PickerSelection = Record<
  string,
  { included: boolean; linkTargetId?: string; linkKind?: "account" | "liability" }
>;

export function buildDecisions(
  accounts: PlaidMappedAccount[],
  selection: PickerSelection,
): PlaidCommitDecision[] {
  return accounts.map((a) => {
    const sel = selection[a.plaidAccountId] ?? { included: false };
    if (!sel.included) return { plaidAccountId: a.plaidAccountId, action: "skip" };

    if (sel.linkTargetId) {
      return sel.linkKind === "liability"
        ? { plaidAccountId: a.plaidAccountId, action: "link-liability", existingLiabilityId: sel.linkTargetId }
        : { plaidAccountId: a.plaidAccountId, action: "link", existingAccountId: sel.linkTargetId };
    }

    const liab = mapPlaidToLiability(a.type, a.subtype);
    if (liab) {
      return { plaidAccountId: a.plaidAccountId, action: "create", kind: "debt", name: a.name, mask: a.mask, balance: a.balance, liabilityType: liab.liabilityType };
    }
    const asset = mapPlaidToFoundry(a.type, a.subtype) ?? { category: "cash", subType: "other" };
    return { plaidAccountId: a.plaidAccountId, action: "create", kind: "asset", name: a.name, mask: a.mask, balance: a.balance, category: asset.category, subType: asset.subType };
  });
}
