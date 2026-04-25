// src/lib/audit/snapshots/extra-payment.ts
import { db } from "@/db";
import { extraPayments, liabilities } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, FieldLabels } from "../types";

export const EXTRA_PAYMENT_FIELD_LABELS: FieldLabels = {
  liability: { label: "Liability", format: "reference" },
  year: { label: "Year", format: "text" },
  type: { label: "Type", format: "text" },
  amount: { label: "Amount", format: "currency" },
};

type ExtraPaymentRow = typeof extraPayments.$inferSelect;

export async function toExtraPaymentSnapshot(
  row: ExtraPaymentRow,
): Promise<EntitySnapshot> {
  const liabilityRows = await db
    .select({ id: liabilities.id, name: liabilities.name })
    .from(liabilities)
    .where(inArray(liabilities.id, [row.liabilityId]));

  return {
    liability: {
      id: row.liabilityId,
      display: liabilityRows[0]?.name ?? "(deleted)",
    },
    year: row.year,
    type: row.type,
    amount: Number(row.amount),
  };
}
