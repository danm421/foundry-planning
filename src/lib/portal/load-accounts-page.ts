import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  clients,
  entities,
  familyMembers,
  liabilities,
  scenarios,
} from "@/db/schema";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";
import { summarizeNetWorth } from "@/lib/portal/portal-networth";
import { reconstructDailyNetWorth, type TrendPoint } from "@/lib/portal/networth-trend";
import { loadPortalDebt, loadPortalTrendTransactions } from "@/lib/portal/load-portal-financials";
import type { NetWorthSummary, PortalAccountRow, PortalDebtRow } from "@/lib/portal/contracts";

export interface AccountsPageOwner {
  familyMemberId: string | null;
  entityId: string | null;
  percent: string;
}

export interface AccountsPageDTO {
  assets: PortalAccountRow[];
  debts: PortalDebtRow[];
  netWorth: NetWorthSummary;
  series: TrendPoint[];
  asOfDate: string;
  familyMembers: { id: string; firstName: string; lastName: string | null; role: string }[];
  trustEntities: { id: string; name: string }[];
  /** Keyed by account id. A plain record, not a Map — this crosses to a client component. */
  ownersByAccountId: Record<string, AccountsPageOwner[]>;
  editEnabled: boolean;
}

/**
 * Everything the portal Accounts page renders, in one server pass. Moved out of
 * `accounts-section.tsx` so the assembly is testable without rendering React and
 * so the page component can stay a thin server shell over one client workspace.
 */
export async function loadAccountsPage(clientId: string): Promise<AccountsPageDTO> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const editEnabled = client?.portalEditEnabled ?? false;

  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  const fms = await db
    .select({
      id: familyMembers.id,
      firstName: familyMembers.firstName,
      lastName: familyMembers.lastName,
      role: familyMembers.role,
    })
    .from(familyMembers)
    .where(eq(familyMembers.clientId, clientId));

  const trustEntities = await db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(and(eq(entities.clientId, clientId), eq(entities.entityType, "trust")));

  const today = new Date().toISOString().slice(0, 10);

  if (!scenario) {
    return {
      assets: [],
      debts: [],
      netWorth: summarizeNetWorth({ assets: 0, debt: 0 }),
      series: [],
      asOfDate: today,
      familyMembers: fms,
      trustEntities,
      ownersByAccountId: {},
      editEnabled,
    };
  }

  const allRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      category: accounts.category,
      subType: accounts.subType,
      value: accounts.value,
      accountNumberLast4: accounts.accountNumberLast4,
      plaidItemId: accounts.plaidItemId,
      isDefaultChecking: accounts.isDefaultChecking,
      parentAccountId: accounts.parentAccountId,
    })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id)));

  // Lean bank-style view: hide engine cash-flow buckets, business sub-accounts,
  // and advisor-only planning categories. Same rule the POST/PUT/DELETE guards use.
  const visible = allRows.filter((r) =>
    isPortalVisibleAccount({
      category: r.category,
      isDefaultChecking: r.isDefaultChecking,
      parentAccountId: r.parentAccountId,
    }),
  );

  const assets: PortalAccountRow[] = visible.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    subType: r.subType,
    last4: r.accountNumberLast4,
    value: Number(r.value || "0"),
    isPlaidLinked: r.plaidItemId != null,
  }));

  const accountIds = assets.map((a) => a.id);
  const owners = accountIds.length
    ? await db
        .select({
          accountId: accountOwners.accountId,
          familyMemberId: accountOwners.familyMemberId,
          entityId: accountOwners.entityId,
          percent: accountOwners.percent,
        })
        .from(accountOwners)
        .where(inArray(accountOwners.accountId, accountIds))
    : [];

  const ownersByAccountId: Record<string, AccountsPageOwner[]> = {};
  for (const o of owners) {
    (ownersByAccountId[o.accountId] ??= []).push({
      familyMemberId: o.familyMemberId,
      entityId: o.entityId,
      percent: o.percent,
    });
  }

  const debts = await loadPortalDebt(clientId, scenario.id);
  const totalAssets = assets.reduce((s, a) => s + a.value, 0);
  const debtTotal = debts.reduce((s, d) => s + d.balance, 0);
  const netWorth = summarizeNetWorth({ assets: totalAssets, debt: debtTotal });

  // Credit-card transactions hang off household liabilities, so the trend needs
  // their Plaid account ids alongside the asset account ids.
  const liabilityPlaidAccountIds = (
    await db
      .select({ plaidAccountId: liabilities.plaidAccountId })
      .from(liabilities)
      .where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenario.id)))
  )
    .map((r) => r.plaidAccountId)
    .filter((x): x is string => x != null);

  const txns = await loadPortalTrendTransactions(clientId, accountIds, liabilityPlaidAccountIds);
  const startDate =
    txns.length > 0 ? txns.reduce((min, t) => (t.date < min ? t.date : min), today) : today;

  return {
    assets,
    debts,
    netWorth,
    series: reconstructDailyNetWorth({
      netWorthNow: netWorth.netWorth,
      asOfDate: today,
      startDate,
      transactions: txns,
    }),
    asOfDate: today,
    familyMembers: fms,
    trustEntities,
    ownersByAccountId,
    editEnabled,
  };
}
