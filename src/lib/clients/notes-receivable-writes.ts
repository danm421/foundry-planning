// src/lib/clients/notes-receivable-writes.ts
// Note-receivable write-core: create and update, moved verbatim out of the
// notes-receivable route handlers so the fact finder save can run them on its
// transaction. The routes keep their gates, params and exact responses; DELETE
// and the extra-payments replace stay in their routes.
//
// Moved as they were: the base-case lookup, the schema parse (400 "Invalid
// input" + details), the sum-to-1 rule, the owner and linked-trust ownership
// checks, the row / owner / extra-payment writes in one transaction, and the
// snapshot audit. Deltas: firmId / actorId / crossFirmMeta are passed in, and
// with a `tx` (a save) every statement runs on it — the ownership checks, the
// audit snapshot and the audit row too.
import {
  externalBeneficiaries,
  familyMembers,
  noteExtraPayments,
  noteReceivableOwners,
  notesReceivable,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { handleOf, inTransaction, type DbOrTx, type WriteOptions } from "@/lib/db-tx";
import { assertEntitiesInClient } from "@/lib/db-scoping";
import { recordCreate, recordUpdate } from "@/lib/audit";
import {
  NOTE_RECEIVABLE_FIELD_LABELS,
  toNoteReceivableSnapshot,
} from "@/lib/audit/snapshots/note-receivable";
import {
  noteReceivableCreateSchema,
  noteReceivableUpdateSchema,
  type NoteReceivableOwnerInput,
} from "@/lib/schemas/note-receivable";
import { summarizeZodIssues } from "@/lib/schemas/common";
import { baseCaseScenarioId } from "./base-case";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type NoteRow = typeof notesReceivable.$inferSelect;
type Refusal = Extract<EntityWriteResult<never>, { ok: false }>;

async function validateOwnersBelongToClient(
  clientId: string,
  owners: NoteReceivableOwnerInput[],
  handle: DbOrTx,
  tx: WriteOptions["tx"],
): Promise<{ error: string } | null> {
  const familyIds = owners.map((o) => o.familyMemberId).filter((x): x is string => !!x);
  const entityIds = owners.map((o) => o.entityId).filter((x): x is string => !!x);
  const extIds = owners
    .map((o) => o.externalBeneficiaryId)
    .filter((x): x is string => !!x);

  if (familyIds.length > 0) {
    const rows = await handle
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.clientId, clientId),
          inArray(familyMembers.id, familyIds),
        ),
      );
    if (rows.length !== familyIds.length) {
      return { error: "Family member owner not found for this client" };
    }
  }
  if (entityIds.length > 0) {
    const check = await assertEntitiesInClient(clientId, entityIds, tx);
    if (!check.ok) return { error: check.reason };
  }
  if (extIds.length > 0) {
    const rows = await handle
      .select({ id: externalBeneficiaries.id })
      .from(externalBeneficiaries)
      .where(
        and(
          eq(externalBeneficiaries.clientId, clientId),
          inArray(externalBeneficiaries.id, extIds),
        ),
      );
    if (rows.length !== extIds.length) {
      return { error: "External beneficiary owner not found for this client" };
    }
  }
  return null;
}

/** The route's `{ error: "Invalid input", details }` response; `error` is the readable reason a save names the line with. */
function invalidInput(error: Parameters<typeof summarizeZodIssues>[0]) {
  return writeError(400, summarizeZodIssues(error), {
    error: "Invalid input",
    details: error.flatten(),
  });
}

/** The create's first refusal: no base case to put a note on (404). A route calls it before it reads the body. */
export async function noteCreateRefusal(clientId: string, firmId: string): Promise<Refusal | null> {
  return (await baseCaseScenarioId(clientId, firmId)) ? null : writeError(404, "Client not found");
}

/** The update's first refusal: the note isn't this client's (404). A route calls it before it reads the body. */
export async function noteUpdateRefusal(
  clientId: string,
  noteId: string,
  opts: WriteOptions = {},
): Promise<Refusal | null> {
  return (await findNote(clientId, noteId, handleOf(opts))) ? null : writeError(404, "Note not found");
}

async function findNote(clientId: string, noteId: string, handle: DbOrTx): Promise<NoteRow | undefined> {
  const [row] = await handle
    .select()
    .from(notesReceivable)
    .where(and(eq(notesReceivable.id, noteId), eq(notesReceivable.clientId, clientId)));
  return row;
}

export async function createNoteReceivableForClient(args: {
  clientId: string;
  firmId: string;
  actorId?: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions): Promise<EntityWriteResult<NoteRow>> {
  const { clientId, firmId, actorId, input, crossFirmMeta } = args;
  const handle = handleOf(args);

  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (!scenarioId) return writeError(404, "Client not found");

  const parsed = noteReceivableCreateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const p = parsed.data;

  const ownerSum = p.owners.reduce((acc, o) => acc + o.percent, 0);
  if (Math.abs(ownerSum - 1) > 0.0001) {
    return writeError(400, "Owner percents must sum to 1 (100%)");
  }

  const ownerErr = await validateOwnersBelongToClient(clientId, p.owners, handle, args.tx);
  if (ownerErr) return writeError(400, ownerErr.error);

  if (p.linkedTrustEntityId) {
    const check = await assertEntitiesInClient(clientId, [p.linkedTrustEntityId], args.tx);
    if (!check.ok) return writeError(400, check.reason);
  }

  let note: NoteRow;
  await inTransaction(args, async (tx) => {
    const [inserted] = await tx
      .insert(notesReceivable)
      .values({
        clientId,
        scenarioId,
        name: p.name,
        faceValue: String(p.faceValue),
        basis: String(p.basis),
        asOfBalance: p.asOfBalance != null ? String(p.asOfBalance) : null,
        balanceAsOfMonth: p.balanceAsOfMonth ?? null,
        balanceAsOfYear: p.balanceAsOfYear ?? null,
        interestRate: String(p.interestRate),
        paymentType: p.paymentType,
        monthlyPayment:
          p.monthlyPayment != null ? String(p.monthlyPayment) : null,
        startYear: p.startYear,
        startMonth: p.startMonth,
        startYearRef: p.startYearRef ?? null,
        termMonths: p.termMonths,
        linkedTrustEntityId: p.linkedTrustEntityId ?? null,
      })
      .returning();
    note = inserted;

    for (const o of p.owners) {
      await tx.insert(noteReceivableOwners).values({
        noteReceivableId: note.id,
        familyMemberId: o.familyMemberId ?? null,
        entityId: o.entityId ?? null,
        externalBeneficiaryId: o.externalBeneficiaryId ?? null,
        percent: String(o.percent),
      });
    }

    for (const ep of p.extraPayments) {
      await tx.insert(noteExtraPayments).values({
        noteReceivableId: note.id,
        year: ep.year,
        type: ep.type,
        amount: String(ep.amount),
      });
    }
  });

  await recordCreate({
    action: "note_receivable.create",
    resourceType: "note_receivable",
    resourceId: note!.id,
    clientId,
    firmId,
    actorId,
    snapshot: await toNoteReceivableSnapshot(note!, args.tx),
    extraMetadata: crossFirmMeta,
    tx: args.tx,
  });

  return { ok: true, data: note!, resourceId: note!.id };
}

export async function updateNoteReceivableForClient(args: {
  clientId: string;
  firmId: string;
  actorId?: string;
  noteId: string;
  input: unknown;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions): Promise<EntityWriteResult<NoteRow>> {
  const { clientId, firmId, actorId, noteId, input, crossFirmMeta } = args;
  const handle = handleOf(args);

  const before = await findNote(clientId, noteId, handle);
  if (!before) return writeError(404, "Note not found");

  const parsed = noteReceivableUpdateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const i = parsed.data;

  if (i.owners !== undefined) {
    const ownerSum = i.owners.reduce((acc, o) => acc + o.percent, 0);
    if (Math.abs(ownerSum - 1) > 0.0001) {
      return writeError(400, "Owner percents must sum to 1 (100%)");
    }
    const ownerErr = await validateOwnersBelongToClient(clientId, i.owners, handle, args.tx);
    if (ownerErr) return writeError(400, ownerErr.error);
  }

  if (i.linkedTrustEntityId) {
    const check = await assertEntitiesInClient(clientId, [i.linkedTrustEntityId], args.tx);
    if (!check.ok) return writeError(400, check.reason);
  }

  const patch: Partial<typeof notesReceivable.$inferInsert> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (i.name !== undefined) patch.name = i.name;
  if (i.faceValue !== undefined) patch.faceValue = String(i.faceValue);
  if (i.basis !== undefined) patch.basis = String(i.basis);
  if (i.asOfBalance !== undefined)
    patch.asOfBalance = i.asOfBalance != null ? String(i.asOfBalance) : null;
  if (i.balanceAsOfMonth !== undefined)
    patch.balanceAsOfMonth = i.balanceAsOfMonth ?? null;
  if (i.balanceAsOfYear !== undefined)
    patch.balanceAsOfYear = i.balanceAsOfYear ?? null;
  if (i.interestRate !== undefined) patch.interestRate = String(i.interestRate);
  if (i.paymentType !== undefined) patch.paymentType = i.paymentType;
  if (i.monthlyPayment !== undefined)
    patch.monthlyPayment =
      i.monthlyPayment != null ? String(i.monthlyPayment) : null;
  if (i.startYear !== undefined) patch.startYear = i.startYear;
  if (i.startMonth !== undefined) patch.startMonth = i.startMonth;
  if (i.startYearRef !== undefined) patch.startYearRef = i.startYearRef ?? null;
  if (i.termMonths !== undefined) patch.termMonths = i.termMonths;
  if (i.linkedTrustEntityId !== undefined)
    patch.linkedTrustEntityId = i.linkedTrustEntityId ?? null;

  let after: NoteRow;
  await inTransaction(args, async (tx) => {
    const [result] = await tx
      .update(notesReceivable)
      .set(patch)
      .where(
        and(eq(notesReceivable.id, noteId), eq(notesReceivable.clientId, clientId)),
      )
      .returning();
    after = result;

    if (i.owners !== undefined) {
      await tx
        .delete(noteReceivableOwners)
        .where(eq(noteReceivableOwners.noteReceivableId, noteId));
      for (const o of i.owners) {
        await tx.insert(noteReceivableOwners).values({
          noteReceivableId: noteId,
          familyMemberId: o.familyMemberId ?? null,
          entityId: o.entityId ?? null,
          externalBeneficiaryId: o.externalBeneficiaryId ?? null,
          percent: String(o.percent),
        });
      }
    }
  });

  await recordUpdate({
    action: "note_receivable.update",
    resourceType: "note_receivable",
    resourceId: noteId,
    clientId,
    firmId,
    actorId,
    before: await toNoteReceivableSnapshot(before, args.tx),
    after: await toNoteReceivableSnapshot(after!, args.tx),
    fieldLabels: NOTE_RECEIVABLE_FIELD_LABELS,
    extraMetadata: crossFirmMeta,
    tx: args.tx,
  });

  return { ok: true, data: after!, resourceId: noteId };
}
