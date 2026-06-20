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

  const rows = scenario
    ? await db
        .select({
          id: accounts.id,
          name: accounts.name,
          category: accounts.category,
          subType: accounts.subType,
          value: accounts.value,
          accountNumberLast4: accounts.accountNumberLast4,
        })
        .from(accounts)
        .where(and(eq(accounts.clientId, clientId), eq(accounts.scenarioId, scenario.id)))
    : [];

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

  return (
    <div className="max-w-3xl space-y-5 p-5">
      <header>
        <h1 className="text-[18px] font-semibold text-ink">Accounts</h1>
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
