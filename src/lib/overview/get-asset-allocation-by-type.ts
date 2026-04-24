import { db } from "@/db";
import { accounts, accountAssetAllocations, assetClasses, clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type Row = { assetTypeGroup: string | null; value: number };
export type Rollup = { group: string; value: number; pct: number };

export function rollupByAssetTypeGroup(rows: Row[]): Rollup[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const g = r.assetTypeGroup ?? "other";
    by.set(g, (by.get(g) ?? 0) + Number(r.value));
  }
  const total = Array.from(by.values()).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Array.from(by.entries())
    .map(([group, value]) => ({ group, value, pct: value / total }))
    .sort((a, b) => b.value - a.value);
}

export async function getAssetAllocationByType(clientId: string, firmId: string): Promise<Rollup[]> {
  const rows = await db
    .select({
      accountValue: accounts.value,
      weight: accountAssetAllocations.weight,
      assetType: assetClasses.assetType,
    })
    .from(accountAssetAllocations)
    .innerJoin(assetClasses, eq(assetClasses.id, accountAssetAllocations.assetClassId))
    .innerJoin(accounts, eq(accounts.id, accountAssetAllocations.accountId))
    .innerJoin(clients, eq(clients.id, accounts.clientId))
    .where(and(eq(accounts.clientId, clientId), eq(clients.firmId, firmId)));

  const input: Row[] = rows.map((r) => ({
    assetTypeGroup: r.assetType ?? null,
    value: Number(r.accountValue ?? 0) * Number(r.weight ?? 0),
  }));

  return rollupByAssetTypeGroup(input);
}
