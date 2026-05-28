import { db } from "@/db";
import {
  accountGroups,
  accountGroupMembers,
  accounts,
} from "@/db/schema";
import { and, eq, inArray, asc } from "drizzle-orm";
import { isLiquid, type AccountCategory } from "./liquid-filter";

export type AccountGroupRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  memberAccountIds: string[];
  liquidMemberCount: number;
  illiquidMemberCount: number;
};

/** List every custom group for a client, each with its member IDs and a
 *  liquid/illiquid count for surfacing the "members no longer eligible" hint. */
export async function listAccountGroups(
  clientId: string,
): Promise<AccountGroupRow[]> {
  const groupRows = await db
    .select()
    .from(accountGroups)
    .where(eq(accountGroups.clientId, clientId))
    .orderBy(asc(accountGroups.sortOrder), asc(accountGroups.name));

  if (groupRows.length === 0) return [];

  const groupIds = groupRows.map((g) => g.id);
  const memberRows = await db
    .select({
      accountGroupId: accountGroupMembers.accountGroupId,
      accountId: accountGroupMembers.accountId,
      category: accounts.category,
    })
    .from(accountGroupMembers)
    .innerJoin(accounts, eq(accounts.id, accountGroupMembers.accountId))
    .where(inArray(accountGroupMembers.accountGroupId, groupIds));

  const byGroup = new Map<string, { ids: string[]; liquid: number; illiquid: number }>();
  for (const g of groupRows) byGroup.set(g.id, { ids: [], liquid: 0, illiquid: 0 });
  for (const m of memberRows) {
    const bucket = byGroup.get(m.accountGroupId);
    if (!bucket) continue;
    bucket.ids.push(m.accountId);
    if (isLiquid(m.category as AccountCategory)) bucket.liquid += 1;
    else bucket.illiquid += 1;
  }

  return groupRows.map((g) => {
    const bucket = byGroup.get(g.id)!;
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      color: g.color,
      sortOrder: g.sortOrder,
      memberAccountIds: bucket.ids,
      liquidMemberCount: bucket.liquid,
      illiquidMemberCount: bucket.illiquid,
    };
  });
}

/** Fetch one custom group's name + color + member account IDs.
 *  Returns null if the group doesn't belong to the given client (404-equivalent). */
export async function fetchAccountGroupForResolver(
  clientId: string,
  groupId: string,
): Promise<{ name: string; color: string | null; memberAccountIds: string[] } | null> {
  const [group] = await db
    .select()
    .from(accountGroups)
    .where(and(eq(accountGroups.id, groupId), eq(accountGroups.clientId, clientId)));
  if (!group) return null;

  const memberRows = await db
    .select({ accountId: accountGroupMembers.accountId })
    .from(accountGroupMembers)
    .where(eq(accountGroupMembers.accountGroupId, groupId));

  return {
    name: group.name,
    color: group.color,
    memberAccountIds: memberRows.map((r) => r.accountId),
  };
}
