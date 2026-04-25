// src/lib/audit/snapshots/liability.ts
import { db } from "@/db";
import { accounts, entities, liabilities } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, FieldLabels, ReferenceValue } from "../types";

export const LIABILITY_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  balance: { label: "Balance", format: "currency" },
  balanceAsOfMonth: { label: "Balance as-of month", format: "text" },
  balanceAsOfYear: { label: "Balance as-of year", format: "text" },
  interestRate: { label: "Interest rate", format: "percent" },
  monthlyPayment: { label: "Monthly payment", format: "currency" },
  startYear: { label: "Start year", format: "text" },
  startMonth: { label: "Start month", format: "text" },
  startYearRef: { label: "Start year ref", format: "text" },
  termMonths: { label: "Term (months)", format: "text" },
  termUnit: { label: "Term unit", format: "text" },
  linkedProperty: { label: "Linked property", format: "reference" },
  ownerEntity: { label: "Owner entity", format: "reference" },
  isInterestDeductible: { label: "Interest deductible", format: "text" },
};

type LiabilityRow = typeof liabilities.$inferSelect;

export async function toLiabilitySnapshot(
  row: LiabilityRow,
): Promise<EntitySnapshot> {
  const linkedProperty = row.linkedPropertyId
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

  const ownerEntity = row.ownerEntityId
    ? await db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(inArray(entities.id, [row.ownerEntityId]))
        .then(
          (rs): ReferenceValue => ({
            id: row.ownerEntityId!,
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
    ownerEntity,
    isInterestDeductible: row.isInterestDeductible,
  };
}
