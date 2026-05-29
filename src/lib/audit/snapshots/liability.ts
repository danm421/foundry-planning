// src/lib/audit/snapshots/liability.ts
import "server-only";
import { db } from "@/db";
import { accounts, liabilities } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, ReferenceValue } from "../types";

// Labels live in the server-free `../field-labels` (audit F3); re-exported
// here so server callers keep one import site.
export { LIABILITY_FIELD_LABELS } from "../field-labels";

type LiabilityRow = typeof liabilities.$inferSelect;

export async function toLiabilitySnapshot(
  row: LiabilityRow,
): Promise<EntitySnapshot> {
  const linkedProperty: ReferenceValue | null = row.linkedPropertyId
    ? await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(inArray(accounts.id, [row.linkedPropertyId]))
        .then(
          (rs): ReferenceValue => ({
            id: row.linkedPropertyId!,
            display: rs[0]?.name ?? "(deleted)",
          }),
        )
    : null;

  return {
    name: row.name,
    balance: Number(row.balance),
    balanceAsOfMonth: row.balanceAsOfMonth,
    balanceAsOfYear: row.balanceAsOfYear,
    interestRate: Number(row.interestRate),
    monthlyPayment: Number(row.monthlyPayment),
    startYear: row.startYear,
    startMonth: row.startMonth,
    startYearRef: row.startYearRef,
    termMonths: row.termMonths,
    termUnit: row.termUnit,
    linkedProperty,
    isInterestDeductible: row.isInterestDeductible,
  };
}
