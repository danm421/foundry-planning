// src/lib/audit/snapshots/transfer.ts
import { db } from "@/db";
import { accounts, transfers } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, FieldLabels, ReferenceValue } from "../types";

export const TRANSFER_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  sourceAccount: { label: "Source account", format: "reference" },
  targetAccount: { label: "Target account", format: "reference" },
  amount: { label: "Amount", format: "currency" },
  mode: { label: "Mode", format: "text" },
  startYear: { label: "Start year", format: "text" },
  startYearRef: { label: "Start year ref", format: "text" },
  endYear: { label: "End year", format: "text" },
  endYearRef: { label: "End year ref", format: "text" },
  growthRate: { label: "Growth rate", format: "percent" },
};

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
