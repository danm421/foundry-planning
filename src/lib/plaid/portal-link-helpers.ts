import { and, eq, isNull } from "drizzle-orm";
import type { AccountBase } from "plaid";
import { db } from "@/db";
import { accounts, liabilities } from "@/db/schema";

export type PlaidMappedAccount = {
  plaidAccountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance: number | null;
};

export function mapPlaidAccount(a: AccountBase): PlaidMappedAccount {
  return {
    plaidAccountId: a.account_id,
    name: a.official_name ?? a.name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    balance: a.balances.current,
  };
}

export async function loadLinkCandidates(clientId: string) {
  const existingCandidates = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      category: accounts.category,
      subType: accounts.subType,
    })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), isNull(accounts.plaidItemId)))
    .orderBy(accounts.name);

  const existingLiabilityCandidates = await db
    .select({
      id: liabilities.id,
      name: liabilities.name,
      liabilityType: liabilities.liabilityType,
      balance: liabilities.balance,
    })
    .from(liabilities)
    .where(and(eq(liabilities.clientId, clientId), isNull(liabilities.plaidItemId)))
    .orderBy(liabilities.name);

  return { existingCandidates, existingLiabilityCandidates };
}
