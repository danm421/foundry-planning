import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmDocumentFolders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureIntakeFolder, INTAKE_FOLDER_NAME } from "../folders";

const FIRM = "test-firm-intake-folder-2026";

async function seedHousehold(): Promise<string> {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: "user_test_intake_folder", name: "Folder Test HH" })
    .returning({ id: crmHouseholds.id });
  return hh.id;
}

afterAll(async () => {
  await db.delete(crmDocumentFolders).where(eq(crmDocumentFolders.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
});

describe("ensureIntakeFolder", () => {
  it("creates the folder, is idempotent, and never marks it portal-root", async () => {
    const householdId = await seedHousehold();

    const first = await ensureIntakeFolder(householdId, FIRM);
    const second = await ensureIntakeFolder(householdId, FIRM);
    expect(second).toBe(first);

    const rows = await db
      .select()
      .from(crmDocumentFolders)
      .where(eq(crmDocumentFolders.householdId, householdId));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(INTAKE_FOLDER_NAME);
    expect(rows[0].isSystem).toBe(true);
    // Security: portal-root is the client-downloadable subtree. Intake files
    // must never be reachable from the portal vault.
    expect(rows[0].isPortalRoot).toBe(false);
  });

  it("backfills for a household that already has other system folders", async () => {
    const householdId = await seedHousehold();
    await db
      .insert(crmDocumentFolders)
      .values({ householdId, firmId: FIRM, name: "Transcripts", isSystem: true });

    const id = await ensureIntakeFolder(householdId, FIRM);

    const [row] = await db
      .select({ name: crmDocumentFolders.name })
      .from(crmDocumentFolders)
      .where(eq(crmDocumentFolders.id, id));
    expect(row.name).toBe(INTAKE_FOLDER_NAME);
  });
});
