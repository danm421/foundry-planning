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

export interface NetWorthSummary {
  assets: number;
  debt: number;
  netWorth: number;
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

/** Presentational debt row consumed by PortalDebtList (household share applied). */
export interface PortalDebtRow {
  id: string;
  name: string;
  balance: number;
  liabilityType: string | null;
  aprPercentage: number | null;
  statementBalance: number | null;
  minimumPayment: number | null;
  nextPaymentDueDate: string | null;
  isPlaidLinked: boolean;
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
    const share = householdOwnedShare(ownersByLiabilityId[l.id] ?? [], roleByFamilyMemberId);
    if (share <= 0) continue;
    rows.push({
      id: l.id,
      name: l.name,
      balance: Number(l.balance) * share,
      liabilityType: l.liabilityType,
      aprPercentage: num(l.aprPercentage),
      statementBalance: num(l.statementBalance),
      minimumPayment: num(l.minimumPayment),
      nextPaymentDueDate: l.nextPaymentDueDate,
      isPlaidLinked: l.plaidItemId != null,
    });
  }
  return rows;
}
