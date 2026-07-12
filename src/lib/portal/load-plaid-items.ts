// src/lib/portal/load-plaid-items.ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import type { PlaidItemDTO } from "@/lib/portal/contracts";
import { deriveItemStatus } from "@/lib/portal/plaid-item-status";

export type { PlaidItemDTO };

export async function loadPlaidItems(clientId: string): Promise<PlaidItemDTO[]> {
  const rows = await db
    .select({
      id: plaidItems.id,
      institutionName: plaidItems.institutionName,
      lastRefreshedAt: plaidItems.lastRefreshedAt,
      lastRefreshError: plaidItems.lastRefreshError,
      transactionsCursor: plaidItems.transactionsCursor,
      newAccountsAvailableAt: plaidItems.newAccountsAvailableAt,
    })
    .from(plaidItems)
    .where(eq(plaidItems.clientId, clientId))
    .orderBy(plaidItems.createdAt);

  return rows.map((r) => ({
    id: r.id,
    institutionName: r.institutionName,
    lastRefreshedAt: r.lastRefreshedAt ? r.lastRefreshedAt.toISOString() : null,
    ...deriveItemStatus(r),
  }));
}
