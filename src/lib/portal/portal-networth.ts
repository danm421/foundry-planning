import type { NetWorthSummary, PortalDebtRow } from "@/lib/portal/contracts";
export type { NetWorthSummary, PortalDebtRow };

export type FamilyRole = string;

export interface LiabilityOwnerShare {
  kind: "family_member" | "entity";
  familyMemberId: string | null;
  entityId: string | null;
  percent: number; // fraction 0..1
}

/** Lean portal view: only client/spouse family-member ownership counts. */
export function householdOwnedShare(
  owners: LiabilityOwnerShare[],
  roleByFamilyMemberId: Record<string, FamilyRole>,
): number {
  let share = 0;
  for (const o of owners) {
    if (o.kind !== "family_member" || o.familyMemberId == null) continue;
    const role = roleByFamilyMemberId[o.familyMemberId];
    if (role === "client" || role === "spouse") share += o.percent;
  }
  return Math.max(0, Math.min(1, share));
}

export function summarizeNetWorth(input: { assets: number; debt: number }): NetWorthSummary {
  return { assets: input.assets, debt: input.debt, netWorth: input.assets - input.debt };
}

/** Raw liability row as loaded from the DB (decimal columns are strings). */
export interface RawLiability {
  id: string;
  name: string;
  balance: string;
  liabilityType: string | null;
  plaidItemId: string | null;
  plaidAccountId: string | null;
  minimumPayment: string | null;
  statementBalance: string | null;
  aprPercentage: string | null;
  nextPaymentDueDate: string | null;
}

function num(s: string | null): number | null {
  return s == null ? null : Number(s);
}

export function buildPortalLiabilityRows(
  rawLiabilities: RawLiability[],
  ownersByLiabilityId: Record<string, LiabilityOwnerShare[]>,
  roleByFamilyMemberId: Record<string, FamilyRole>,
): PortalDebtRow[] {
  const rows: PortalDebtRow[] = [];
  for (const l of rawLiabilities) {
    const owners = ownersByLiabilityId[l.id] ?? [];
    // A liability with no owner rows is household-owned by default — this is how
    // Plaid "Add as new" debts are created (commit route writes no liability_owners
    // row). Liabilities WITH explicit owner rows (e.g. entity/trust-owned) are
    // scored normally and may still be filtered out at share <= 0.
    const share = owners.length === 0 ? 1 : householdOwnedShare(owners, roleByFamilyMemberId);
    if (share <= 0) continue;
    rows.push({
      id: l.id,
      name: l.name,
      balance: Number(l.balance) * share,
      rawBalance: Number(l.balance),
      liabilityType: l.liabilityType,
      aprPercentage: num(l.aprPercentage),
      statementBalance: num(l.statementBalance),
      minimumPayment: num(l.minimumPayment),
      nextPaymentDueDate: l.nextPaymentDueDate,
      isPlaidLinked: l.plaidItemId != null,
      ownerFmIds: owners
        .filter((o) => o.kind === "family_member" && o.familyMemberId != null)
        .map((o) => o.familyMemberId!),
      ownerEntityIds: owners
        .filter((o) => o.kind === "entity" && o.entityId != null)
        .map((o) => o.entityId!),
    });
  }
  return rows;
}
