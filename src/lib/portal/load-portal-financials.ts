import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { liabilities, liabilityOwners, familyMembers, plaidTransactions } from "@/db/schema";
import {
  buildPortalLiabilityRows,
  type LiabilityOwnerShare,
  type PortalDebtRow,
  type RawLiability,
} from "@/lib/portal/portal-networth";
import type { TrendTransaction } from "@/lib/portal/networth-trend";

export async function loadPortalDebt(
  clientId: string,
  scenarioId: string,
): Promise<PortalDebtRow[]> {
  const raw: RawLiability[] = await db
    .select({
      id: liabilities.id,
      name: liabilities.name,
      balance: liabilities.balance,
      liabilityType: liabilities.liabilityType,
      plaidItemId: liabilities.plaidItemId,
      plaidAccountId: liabilities.plaidAccountId,
      minimumPayment: liabilities.minimumPayment,
      statementBalance: liabilities.statementBalance,
      aprPercentage: liabilities.aprPercentage,
      nextPaymentDueDate: liabilities.nextPaymentDueDate,
    })
    .from(liabilities)
    .where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenarioId)));

  if (raw.length === 0) return [];

  const owners = await db
    .select({
      liabilityId: liabilityOwners.liabilityId,
      familyMemberId: liabilityOwners.familyMemberId,
      entityId: liabilityOwners.entityId,
      percent: liabilityOwners.percent,
    })
    .from(liabilityOwners)
    .where(inArray(liabilityOwners.liabilityId, raw.map((r) => r.id)));

  const fms = await db
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, clientId));

  const roleByFamilyMemberId: Record<string, string> = {};
  for (const f of fms) roleByFamilyMemberId[f.id] = f.role;

  const ownersByLiabilityId: Record<string, LiabilityOwnerShare[]> = {};
  for (const o of owners) {
    (ownersByLiabilityId[o.liabilityId] ??= []).push({
      kind: o.familyMemberId != null ? "family_member" : "entity",
      familyMemberId: o.familyMemberId,
      entityId: o.entityId,
      percent: Number(o.percent),
    });
  }

  return buildPortalLiabilityRows(raw, ownersByLiabilityId, roleByFamilyMemberId);
}

export async function loadPortalTrendTransactions(
  clientId: string,
  assetAccountIds: string[],
  liabilityPlaidAccountIds: string[],
): Promise<TrendTransaction[]> {
  if (assetAccountIds.length === 0 && liabilityPlaidAccountIds.length === 0) return [];
  const rows = await db
    .select({
      date: plaidTransactions.date,
      amount: plaidTransactions.amount,
      accountId: plaidTransactions.accountId,
      plaidAccountId: plaidTransactions.plaidAccountId,
    })
    .from(plaidTransactions)
    .where(and(eq(plaidTransactions.clientId, clientId), eq(plaidTransactions.pending, false)));

  const assetSet = new Set(assetAccountIds);
  const liabSet = new Set(liabilityPlaidAccountIds);
  return rows
    .filter(
      (r) =>
        (r.accountId != null && assetSet.has(r.accountId)) ||
        (r.accountId == null && r.plaidAccountId != null && liabSet.has(r.plaidAccountId)),
    )
    .map((r) => ({ date: r.date, amount: Number(r.amount) }));
}
