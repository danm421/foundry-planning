// src/lib/integrations/plaid-usage.ts
import { countDistinct, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, plaidItems } from "@/db/schema";

/** How many of the firm's clients have linked an institution through Plaid, and
 *  across how many institutions. Read-only — Plaid has no firm-level setup. */
export async function getPlaidUsage(
  firmId: string,
): Promise<{ clientCount: number; institutionCount: number }> {
  const [row] = await db
    .select({
      clientCount: countDistinct(plaidItems.clientId),
      institutionCount: countDistinct(plaidItems.institutionId),
    })
    .from(plaidItems)
    .innerJoin(clients, eq(clients.id, plaidItems.clientId))
    .where(eq(clients.firmId, firmId));
  return { clientCount: row?.clientCount ?? 0, institutionCount: row?.institutionCount ?? 0 };
}
