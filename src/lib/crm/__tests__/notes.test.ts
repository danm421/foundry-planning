import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds, crmActivity, auditLog } from "@/db/schema";
import { NOTE_KINDS, listHouseholdNotes, createNote, updateNote, deleteNote } from "../notes";

// Each later task (4/5/6) ADDS its function to this import line when it adds
// its describe block — keep the import in sync with what's implemented so the
// ESM module loads (importing a not-yet-exported name fails the whole file).

// notes.ts takes firmId/actorUserId explicitly and never calls Clerk auth(),
// so no Clerk/requireOrgId mocks are needed (recordAudit receives actorId and
// thus short-circuits its auth() fallback).

const ORG = "test_org_notes";
const OTHER_ORG = "test_org_notes_other";
const USER = "user_notes_test";

let householdId: string;

async function cleanup() {
  for (const firm of [ORG, OTHER_ORG]) {
    const hh = await db.query.crmHouseholds.findMany({
      where: eq(crmHouseholds.firmId, firm),
      columns: { id: true },
    });
    for (const h of hh) {
      await db.delete(crmActivity).where(eq(crmActivity.householdId, h.id));
    }
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firm));
    await db.delete(auditLog).where(eq(auditLog.firmId, firm));
  }
}

async function makeHousehold(firmId: string, name = "Notes Household") {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "test_advisor", name })
    .returning();
  return h;
}

beforeEach(async () => {
  await cleanup();
  const h = await makeHousehold(ORG);
  householdId = h.id;
});

describe("NOTE_KINDS", () => {
  it("is exactly the four human kinds", () => {
    expect([...NOTE_KINDS]).toEqual(["note", "meeting", "call", "email"]);
  });
});

describe("listHouseholdNotes", () => {
  // Seed via direct inserts (createNote is implemented in Task 4) so this task's
  // test loads and passes standalone.
  it("returns only note kinds, newest-first, scoped to household+firm", async () => {
    await db.insert(crmActivity).values([
      // System-kind row that must be excluded.
      {
        householdId, firmId: ORG, actorUserId: USER,
        kind: "status_change", title: "Status changed",
        occurredAt: new Date("2026-06-20T12:00:00.000Z"),
      },
      {
        householdId, firmId: ORG, actorUserId: USER,
        kind: "meeting", title: "Older meeting",
        occurredAt: new Date("2026-06-10T12:00:00.000Z"),
      },
      {
        householdId, firmId: ORG, actorUserId: USER,
        kind: "call", title: "Newer call",
        occurredAt: new Date("2026-06-15T12:00:00.000Z"),
      },
    ]);

    const rows = await listHouseholdNotes(householdId, ORG);
    expect(rows.map((r) => r.title)).toEqual(["Newer call", "Older meeting"]);
    expect(rows.every((r) => NOTE_KINDS.includes(r.kind))).toBe(true);
  });

  it("does not leak another household's notes", async () => {
    const other = await makeHousehold(ORG, "Other Household");
    await db.insert(crmActivity).values({
      householdId: other.id, firmId: ORG, actorUserId: USER,
      kind: "note", title: "Other note", occurredAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    const rows = await listHouseholdNotes(householdId, ORG);
    expect(rows).toHaveLength(0);
  });
});

describe("createNote", () => {
  it("inserts a crm_activity row with mapped fields and writes audit", async () => {
    const note = await createNote(householdId, ORG, USER, {
      subject: "Kickoff meeting",
      body: "**Discussed** goals",
      noteKind: "meeting",
      noteDate: "2026-06-15",
    });

    expect(note.title).toBe("Kickoff meeting");
    expect(note.body).toBe("**Discussed** goals");
    expect(note.kind).toBe("meeting");
    // noon-UTC mapping
    expect(note.occurredAt).toBe("2026-06-15T12:00:00.000Z");
    expect(note.actorUserId).toBe(USER);

    const row = await db.query.crmActivity.findFirst({
      where: eq(crmActivity.id, note.id),
    });
    expect(row?.firmId).toBe(ORG);
    expect(row?.householdId).toBe(householdId);

    const audits = await db.query.auditLog.findMany({
      where: and(eq(auditLog.firmId, ORG), eq(auditLog.resourceType, "crm_note")),
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("crm.note.create");
    expect(audits[0].resourceId).toBe(note.id);
  });

  it("rejects a household outside the firm", async () => {
    const other = await makeHousehold(OTHER_ORG, "Foreign Household");
    await expect(
      createNote(other.id, ORG, USER, {
        subject: "x",
        body: "",
        noteKind: "note",
        noteDate: "2026-06-15",
      }),
    ).rejects.toThrow(/not found in firm/i);
  });
});

describe("updateNote", () => {
  it("updates only the provided fields and writes audit", async () => {
    const note = await createNote(householdId, ORG, USER, {
      subject: "Draft",
      body: "old",
      noteKind: "note",
      noteDate: "2026-06-15",
    });

    const updated = await updateNote(note.id, householdId, ORG, USER, {
      subject: "Final",
      noteKind: "meeting",
    });

    expect(updated.title).toBe("Final");
    expect(updated.kind).toBe("meeting");
    expect(updated.body).toBe("old"); // untouched
    expect(updated.occurredAt).toBe("2026-06-15T12:00:00.000Z"); // untouched

    const audits = await db.query.auditLog.findMany({
      where: and(eq(auditLog.firmId, ORG), eq(auditLog.resourceType, "crm_note")),
    });
    expect(audits.some((a) => a.action === "crm.note.update")).toBe(true);
  });

  it("remaps noteDate to a noon-UTC occurredAt", async () => {
    const note = await createNote(householdId, ORG, USER, {
      subject: "x", body: "", noteKind: "note", noteDate: "2026-06-15",
    });
    const updated = await updateNote(note.id, householdId, ORG, USER, { noteDate: "2026-07-01" });
    expect(updated.occurredAt).toBe("2026-07-01T12:00:00.000Z");
  });

  it("refuses to update a system-kind activity row", async () => {
    const [sys] = await db
      .insert(crmActivity)
      .values({
        householdId,
        firmId: ORG,
        actorUserId: USER,
        kind: "status_change",
        title: "Status",
        occurredAt: new Date(),
      })
      .returning();
    await expect(
      updateNote(sys.id, householdId, ORG, USER, { subject: "hijack" }),
    ).rejects.toThrow(/note not found/i);
  });

  it("refuses a note from another household", async () => {
    const other = await makeHousehold(ORG, "Other HH");
    const note = await createNote(other.id, ORG, USER, {
      subject: "x", body: "", noteKind: "note", noteDate: "2026-06-15",
    });
    await expect(
      updateNote(note.id, householdId, ORG, USER, { subject: "y" }),
    ).rejects.toThrow(/note not found/i);
  });
});

describe("deleteNote", () => {
  it("deletes the note row and writes audit", async () => {
    const note = await createNote(householdId, ORG, USER, {
      subject: "Trash me", body: "", noteKind: "note", noteDate: "2026-06-15",
    });
    await deleteNote(note.id, householdId, ORG, USER);

    const row = await db.query.crmActivity.findFirst({ where: eq(crmActivity.id, note.id) });
    expect(row).toBeUndefined();

    const audits = await db.query.auditLog.findMany({
      where: and(eq(auditLog.firmId, ORG), eq(auditLog.resourceType, "crm_note")),
    });
    expect(audits.some((a) => a.action === "crm.note.delete")).toBe(true);
  });

  it("refuses to delete a system-kind activity row", async () => {
    const [sys] = await db
      .insert(crmActivity)
      .values({
        householdId, firmId: ORG, actorUserId: USER,
        kind: "document_uploaded", title: "Doc", occurredAt: new Date(),
      })
      .returning();
    await expect(deleteNote(sys.id, householdId, ORG, USER)).rejects.toThrow(/note not found/i);
    const stillThere = await db.query.crmActivity.findFirst({ where: eq(crmActivity.id, sys.id) });
    expect(stillThere).toBeDefined();
  });
});
