import type { ReactElement } from "react";
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
import ProfileAccountsList from "@/components/portal/profile-accounts-list";
import { PortalNetWorthHeader } from "@/components/portal/portal-networth-header";
import { PortalDebtList } from "@/components/portal/portal-debt-list";
import { NetWorthTrendChart } from "@/components/portal/networth-trend-chart";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";
import { summarizeNetWorth } from "@/lib/portal/portal-networth";
import { reconstructDailyNetWorth } from "@/lib/portal/networth-trend";
import { loadPortalDebt, loadPortalTrendTransactions } from "@/lib/portal/load-portal-financials";

interface Props {
  clientId: string;
  previewing?: boolean;
}

export default async function AccountsSection({
  clientId,
  previewing = false,
}: Props): Promise<ReactElement> {
  const [client] = await db
    .select({ portalEditEnabled: clients.portalEditEnabled })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  const allRows = scenario
    ? await db
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
        .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id)))
    : [];

  // Lean bank-style view: hide engine cash-flow buckets, business sub-accounts,
  // and advisor-only planning categories. Single source of truth shared with
  // the portal account POST/PUT/DELETE guards.
  const rows = allRows.filter((r) =>
    isPortalVisibleAccount({
      category: r.category,
      isDefaultChecking: r.isDefaultChecking,
      parentAccountId: r.parentAccountId,
    }),
  );

  const accountIds = rows.map((r) => r.id);
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

  const editEnabled = previewing ? false : (client?.portalEditEnabled ?? false);

  const ownersByAccount = new Map<string, Array<(typeof owners)[number]>>();
  for (const o of owners) {
    const list = ownersByAccount.get(o.accountId) ?? [];
    list.push(o);
    ownersByAccount.set(o.accountId, list);
  }

  const assetAccountIds = rows.map((r) => r.id);
  const totalAssets = rows.reduce((s, r) => s + Number(r.value || "0"), 0);

  const debtRows = scenario ? await loadPortalDebt(clientId, scenario.id) : [];
  const debtTotal = debtRows.reduce((s, r) => s + r.balance, 0);
  const summary = summarizeNetWorth({ assets: totalAssets, debt: debtTotal });

  // Collect Plaid account IDs from all household liabilities (for credit-card txns).
  const liabilityPlaidAccountIds = (
    scenario
      ? await db
          .select({ plaidAccountId: liabilities.plaidAccountId })
          .from(liabilities)
          .where(and(eq(liabilities.clientId, clientId), eq(liabilities.scenarioId, scenario.id)))
      : []
  )
    .map((r) => r.plaidAccountId)
    .filter((x): x is string => x != null);

  const today = new Date().toISOString().slice(0, 10);
  const txns = await loadPortalTrendTransactions(clientId, assetAccountIds, liabilityPlaidAccountIds);
  const startDate =
    txns.length > 0
      ? txns.reduce((min, t) => (t.date < min ? t.date : min), today)
      : today;
  const series = reconstructDailyNetWorth({
    netWorthNow: summary.netWorth,
    asOfDate: today,
    startDate,
    transactions: txns,
  });

  return (
    <div className="max-w-3xl space-y-5 p-5">
      <PortalNetWorthHeader assets={summary.assets} debt={summary.debt} netWorth={summary.netWorth} />
      <NetWorthTrendChart series={series} asOfDate={today} />
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-ink-2">Accounts</h3>
        <ProfileAccountsList
          rows={rows.map((r) => ({
            ...r,
            owners: ownersByAccount.get(r.id) ?? [],
          }))}
          familyMembers={fms}
          trustEntities={trustEntities}
          editEnabled={editEnabled}
        />
      </section>
      <PortalDebtList rows={debtRows} />
    </div>
  );
}
