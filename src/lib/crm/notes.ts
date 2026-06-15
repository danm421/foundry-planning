import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { crmActivity, crmHouseholds } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

import type { CreateCrmNoteInput, UpdateCrmNoteInput } from "./schemas";

/**
 * "Notes" are a focused view over `crm_activity`, restricted to the four
 * human-authored kinds. This module performs no auth (takes firmId/actorUserId
 * explicitly) so it stays testable in plain vitest, mirroring
 * `src/lib/crm-tasks/mutations.ts`. The route layer gates with
 * `requireCrmHouseholdAccess`.
 */

export const NOTE_KINDS = ["note", "meeting", "call", "email"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type NoteRow = {
  id: string;
  kind: NoteKind; // "note" surfaces as "General" in the UI; meeting/call/email map 1:1
  title: string; // subject
  body: string; // markdown
  occurredAt: string; // ISO; date shown UTC
  actorUserId: string | null;
  updatedAt: string;
};

function toNoteRow(row: typeof crmActivity.$inferSelect): NoteRow {
  return {
    id: row.id,
    kind: row.kind as NoteKind,
    title: row.title,
    body: row.body ?? "",
    occurredAt: row.occurredAt.toISOString(),
    actorUserId: row.actorUserId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// A YYYY-MM-DD note date is stored at noon UTC so the displayed UTC date always
// equals the entered calendar date in any US timezone.
function noteDateToOccurredAt(noteDate: string): Date {
  return new Date(`${noteDate}T12:00:00.000Z`);
}

async function assertHouseholdInFirm(householdId: string, firmId: string) {
  const hh = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, householdId), eq(crmHouseholds.firmId, firmId)),
    columns: { id: true },
  });
  if (!hh) throw new Error("Household not found in firm");
}

// Loads a note row scoped to household+firm. Throws if missing OR if its kind
// is not a note kind — so the Notes surface can never mutate a system event.
async function loadNoteOrThrow(noteId: string, householdId: string, firmId: string) {
  const row = await db.query.crmActivity.findFirst({
    where: and(
      eq(crmActivity.id, noteId),
      eq(crmActivity.householdId, householdId),
      eq(crmActivity.firmId, firmId),
    ),
  });
  if (!row || !NOTE_KINDS.includes(row.kind as NoteKind)) {
    throw new Error("Note not found");
  }
  return row;
}

export async function listHouseholdNotes(
  householdId: string,
  firmId: string,
): Promise<NoteRow[]> {
  const rows = await db
    .select()
    .from(crmActivity)
    .where(
      and(
        eq(crmActivity.householdId, householdId),
        eq(crmActivity.firmId, firmId),
        inArray(crmActivity.kind, [...NOTE_KINDS]),
      ),
    )
    .orderBy(desc(crmActivity.occurredAt), desc(crmActivity.createdAt));
  return rows.map(toNoteRow);
}

export async function createNote(
  householdId: string,
  firmId: string,
  actorUserId: string,
  input: CreateCrmNoteInput,
): Promise<NoteRow> {
  await assertHouseholdInFirm(householdId, firmId);

  const [row] = await db
    .insert(crmActivity)
    .values({
      householdId,
      firmId,
      actorUserId,
      kind: input.noteKind,
      title: input.subject,
      body: input.body,
      occurredAt: noteDateToOccurredAt(input.noteDate),
    })
    .returning();

  await recordAudit({
    action: "crm.note.create",
    resourceType: "crm_note",
    resourceId: row.id,
    firmId,
    actorId: actorUserId,
    metadata: { householdId, kind: row.kind, title: row.title },
  });

  return toNoteRow(row);
}

export async function updateNote(
  noteId: string,
  householdId: string,
  firmId: string,
  actorUserId: string,
  input: UpdateCrmNoteInput,
): Promise<NoteRow> {
  await loadNoteOrThrow(noteId, householdId, firmId);

  const patch: Partial<typeof crmActivity.$inferInsert> = { updatedAt: new Date() };
  if (input.subject !== undefined) patch.title = input.subject;
  if (input.body !== undefined) patch.body = input.body;
  if (input.noteKind !== undefined) patch.kind = input.noteKind;
  if (input.noteDate !== undefined) patch.occurredAt = noteDateToOccurredAt(input.noteDate);

  const [row] = await db
    .update(crmActivity)
    .set(patch)
    .where(
      and(
        eq(crmActivity.id, noteId),
        eq(crmActivity.householdId, householdId),
        eq(crmActivity.firmId, firmId),
      ),
    )
    .returning();

  // loadNoteOrThrow already proved the row exists; an empty returning here means
  // a concurrent delete raced us. Surface a clean domain error, not a TypeError.
  if (!row) throw new Error("Note not found");

  await recordAudit({
    action: "crm.note.update",
    resourceType: "crm_note",
    resourceId: noteId,
    firmId,
    actorId: actorUserId,
    metadata: { householdId, fields: Object.keys(input) },
  });

  return toNoteRow(row);
}

export async function deleteNote(
  noteId: string,
  householdId: string,
  firmId: string,
  actorUserId: string,
): Promise<void> {
  await loadNoteOrThrow(noteId, householdId, firmId);

  await db
    .delete(crmActivity)
    .where(
      and(
        eq(crmActivity.id, noteId),
        eq(crmActivity.householdId, householdId),
        eq(crmActivity.firmId, firmId),
      ),
    );

  await recordAudit({
    action: "crm.note.delete",
    resourceType: "crm_note",
    resourceId: noteId,
    firmId,
    actorId: actorUserId,
    metadata: { householdId },
  });
}
