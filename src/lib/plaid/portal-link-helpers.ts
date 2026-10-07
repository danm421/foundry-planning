import { and, eq, isNull } from "drizzle-orm";
import type { AccountBase } from "plaid";
import { db } from "@/db";
import { accounts, liabilities } from "@/db/schema";
import type { PlaidMappedAccount } from "@/lib/portal/contracts";
import {
  isPortalVisibleAccount,
  toPortalAccountVisibility,
} from "@/lib/portal/account-visibility";

export type { PlaidMappedAccount };

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
  const candidateRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      category: accounts.category,
      subType: accounts.subType,
      isDefaultChecking: accounts.isDefaultChecking,
      parentAccountId: accounts.parentAccountId,
    })
    .from(accounts)
    .where(and(eq(accounts.clientId, clientId), isNull(accounts.plaidItemId)))
    .orderBy(accounts.name);

  // Offer only accounts the portal shows the client; the commit route enforces
  // the same rule.
  const existingCandidates = candidateRows
    .filter((a) => isPortalVisibleAccount(toPortalAccountVisibility(a)))
    .map(({ id, name, category, subType }) => ({ id, name, category, subType }));

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
