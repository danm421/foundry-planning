import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds, crmActivity, auditLog } from "@/db/schema";
import { NOTE_KINDS, listHouseholdNotes } from "../notes";

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
