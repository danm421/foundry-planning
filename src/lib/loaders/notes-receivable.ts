import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  notesReceivable as notesReceivableTable,
  noteExtraPayments as noteExtraPaymentsTable,
  noteReceivableOwners as noteReceivableOwnersTable,
} from "@/db/schema";
import type { NoteReceivable } from "@/engine/notes-receivable";
import type { AccountOwner } from "@/engine/ownership";

export async function loadNotesReceivable(
  clientId: string,
  scenarioId: string,
): Promise<NoteReceivable[]> {
  const rows = await db
    .select()
    .from(notesReceivableTable)
    .where(
      and(
        eq(notesReceivableTable.clientId, clientId),
        eq(notesReceivableTable.scenarioId, scenarioId),
      ),
    );

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [extras, owners] = await Promise.all([
    db
      .select()
      .from(noteExtraPaymentsTable)
      .where(inArray(noteExtraPaymentsTable.noteReceivableId, ids)),
    db
      .select()
      .from(noteReceivableOwnersTable)
      .where(inArray(noteReceivableOwnersTable.noteReceivableId, ids)),
  ]);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    faceValue: parseFloat(r.faceValue),
    basis: parseFloat(r.basis),
    asOfBalance: r.asOfBalance != null ? parseFloat(r.asOfBalance) : undefined,
    balanceAsOfMonth: r.balanceAsOfMonth ?? undefined,
    balanceAsOfYear: r.balanceAsOfYear ?? undefined,
    interestRate: parseFloat(r.interestRate),
    paymentType: r.paymentType,
    monthlyPayment:
      r.monthlyPayment != null ? parseFloat(r.monthlyPayment) : undefined,
    startYear: r.startYear,
    startMonth: r.startMonth,
    termMonths: r.termMonths,
    linkedTrustEntityId: r.linkedTrustEntityId,
    extraPayments: extras
      .filter((e) => e.noteReceivableId === r.id)
      .map((e) => ({
        id: e.id,
        noteReceivableId: e.noteReceivableId,
        year: e.year,
        type: e.type,
        amount: parseFloat(e.amount),
      })),
    owners: owners
      .filter((o) => o.noteReceivableId === r.id)
      .map((o): AccountOwner => {
        if (o.externalBeneficiaryId != null) {
          return {
            kind: "external_beneficiary",
            externalBeneficiaryId: o.externalBeneficiaryId,
            percent: parseFloat(o.percent),
          };
        }
        if (o.familyMemberId != null) {
          return {
            kind: "family_member",
            familyMemberId: o.familyMemberId,
            percent: parseFloat(o.percent),
          };
        }
        return {
          kind: "entity",
          entityId: o.entityId!,
          percent: parseFloat(o.percent),
        };
      }),
  }));
}
