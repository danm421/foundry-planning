import type { ReactElement } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountOwners,
  clients,
  entities,
  familyMembers,
  scenarios,
} from "@/db/schema";
import ProfileAccountsList from "@/components/portal/profile-accounts-list";
import { isPortalVisibleAccount } from "@/lib/portal/account-visibility";

interface Props {
  clientId: string;
  previewing?: boolean;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
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

  const totalAssets = rows.reduce((s, r) => s + Number(r.value || "0"), 0);

  return (
    <div className="max-w-3xl space-y-5 p-5">
      <header>
        <h1 className="text-[18px] font-semibold text-ink">Accounts</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">
          Total assets{" "}
          <span className="ml-1 font-semibold tabular-nums text-ink">
            {fmtUsd(totalAssets)}
          </span>
        </p>
      </header>
      <ProfileAccountsList
        rows={rows.map((r) => ({
          ...r,
          owners: ownersByAccount.get(r.id) ?? [],
        }))}
        familyMembers={fms}
        trustEntities={trustEntities}
        editEnabled={editEnabled}
      />
    </div>
  );
}
