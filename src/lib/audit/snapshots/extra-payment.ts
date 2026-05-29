// src/lib/audit/snapshots/extra-payment.ts
import "server-only";
import { db } from "@/db";
import { extraPayments, liabilities } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot } from "../types";

// Labels live in the server-free `../field-labels` (audit F3); re-exported
// here so server callers keep one import site.
export { EXTRA_PAYMENT_FIELD_LABELS } from "../field-labels";

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
