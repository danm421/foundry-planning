import { and, eq } from "drizzle-orm";
import { netAccountValue } from "@/lib/accounts/net-value";
import { linkedStatusOf } from "@/lib/accounts/linked-source";
import { db } from "@/db";
import { accounts, plaidItems, scenarios } from "@/db/schema";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";
import { loadPortalDebt } from "@/lib/portal/load-portal-financials";
import { summarizeNetWorth } from "@/lib/portal/portal-networth";
import type { AccountsOverviewDTO, PortalAccountRow } from "@/lib/portal/contracts";

/**
 * Bank-style accounts overview for the portal (mobile Accounts screen). Assets
 * come from the base-case scenario, filtered to portal-visible accounts (the
 * same isPortalVisibleAccount rule the web page + POST/PUT/DELETE guards use);
 * debts come from loadPortalDebt (household-share applied). No net-worth trend
 * series here — the dashboard already provides it.
 */
export async function loadAccountsOverview(clientId: string): Promise<AccountsOverviewDTO> {
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  if (!scenario) {
    return { assets: [], debts: [], netWorth: summarizeNetWorth({ assets: 0, debt: 0 }) };
  }

  const rawRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      category: accounts.category,
      subType: accounts.subType,
      value: accounts.value,
      marginBalance: accounts.marginBalance,
      accountNumberLast4: accounts.accountNumberLast4,
      plaidItemId: accounts.plaidItemId,
      externalProvider: accounts.externalProvider,
      source: accounts.source,
      lastSyncedAt: accounts.lastSyncedAt,
      plaidRefreshedAt: plaidItems.lastRefreshedAt,
      plaidRefreshError: plaidItems.lastRefreshError,
      isDefaultChecking: accounts.isDefaultChecking,
      parentAccountId: accounts.parentAccountId,
    })
    .from(accounts)
    .leftJoin(plaidItems, eq(plaidItems.id, accounts.plaidItemId))
    .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id)));

  const assets: PortalAccountRow[] = rawRows
    .filter((r) =>
      isPortalVisibleAccount({
        category: r.category,
        isDefaultChecking: r.isDefaultChecking,
        parentAccountId: r.parentAccountId,
      }),
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      subType: r.subType,
      last4: r.accountNumberLast4,
      value: netAccountValue(r),
      isPlaidLinked: r.plaidItemId != null,
      linked: linkedStatusOf(r),
    }));

  const debts = await loadPortalDebt(clientId, scenario.id);

  const totalAssets = assets.reduce((s, a) => s + a.value, 0);
  const debtTotal = debts.reduce((s, d) => s + d.balance, 0);

  return { assets, debts, netWorth: summarizeNetWorth({ assets: totalAssets, debt: debtTotal }) };
}
