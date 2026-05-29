// src/lib/audit/snapshots/transfer.ts
import "server-only";
import { db } from "@/db";
import { accounts, transfers } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, ReferenceValue } from "../types";

// Labels live in the server-free `../field-labels` (audit F3); re-exported
// here so server callers keep one import site.
export { TRANSFER_FIELD_LABELS } from "../field-labels";

type TransferRow = typeof transfers.$inferSelect;

export async function toTransferSnapshot(
  row: TransferRow,
): Promise<EntitySnapshot> {
  const ids = [row.sourceAccountId, row.targetAccountId];
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(inArray(accounts.id, ids));
  const map = new Map(accountRows.map((r) => [r.id, r.name]));

  const ref = (id: string): ReferenceValue => ({
    id,
    display: map.get(id) ?? "(deleted)",
  });

  return {
    name: row.name,
    sourceAccount: ref(row.sourceAccountId),
    targetAccount: ref(row.targetAccountId),
    amount: Number(row.amount),
    mode: row.mode,
    startYear: row.startYear,
    startYearRef: row.startYearRef,
    endYear: row.endYear,
    endYearRef: row.endYearRef,
    growthRate: Number(row.growthRate),
  };
}
