// src/lib/audit/snapshots/note-receivable.ts
import "server-only";
import { db } from "@/db";
import { entities, notesReceivable } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { EntitySnapshot, FieldLabels, ReferenceValue } from "../types";

export const NOTE_RECEIVABLE_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  faceValue: { label: "Face value", format: "currency" },
  basis: { label: "Basis", format: "currency" },
  asOfBalance: { label: "Balance as-of", format: "currency" },
  balanceAsOfMonth: { label: "Balance as-of month", format: "text" },
  balanceAsOfYear: { label: "Balance as-of year", format: "text" },
  interestRate: { label: "Interest rate", format: "percent" },
  paymentType: { label: "Payment type", format: "text" },
  monthlyPayment: { label: "Monthly payment", format: "currency" },
  startYear: { label: "Start year", format: "text" },
  startMonth: { label: "Start month", format: "text" },
  startYearRef: { label: "Start year ref", format: "text" },
  termMonths: { label: "Term (months)", format: "text" },
  linkedTrust: { label: "Linked trust", format: "reference" },
};

type NoteReceivableRow = typeof notesReceivable.$inferSelect;

export async function toNoteReceivableSnapshot(
  row: NoteReceivableRow,
): Promise<EntitySnapshot> {
  const linkedTrust: ReferenceValue | null = row.linkedTrustEntityId
    ? await db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(inArray(entities.id, [row.linkedTrustEntityId]))
        .then(
          (rs): ReferenceValue => ({
            id: row.linkedTrustEntityId!,
            display: rs[0]?.name ?? "(deleted)",
          }),
        )
    : null;

  return {
    name: row.name,
    faceValue: Number(row.faceValue),
    basis: Number(row.basis),
    asOfBalance: row.asOfBalance != null ? Number(row.asOfBalance) : null,
    balanceAsOfMonth: row.balanceAsOfMonth,
    balanceAsOfYear: row.balanceAsOfYear,
    interestRate: Number(row.interestRate),
    paymentType: row.paymentType,
    monthlyPayment: row.monthlyPayment != null ? Number(row.monthlyPayment) : null,
    startYear: row.startYear,
    startMonth: row.startMonth,
    startYearRef: row.startYearRef,
    termMonths: row.termMonths,
    linkedTrust,
  };
}
