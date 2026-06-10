import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmDocumentFolders } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_folders_test") };
});

vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
    "@clerk/nextjs/server",
  );
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { listFolders, SYSTEM_FOLDERS } from "../folders";

const ORG = "org_folders_test";
let householdId: string;

function setAuth(userId: string, orgRole?: string) {
  vi.mocked(auth).mockResolvedValue({ userId, orgId: ORG, orgRole } as never);
}

beforeEach(async () => {
  setAuth("user_folders", "org:admin");
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "user_folders", name: "HH" })
    .returning();
  householdId = h.id;
});

describe("listFolders + system seed", () => {
  it("lazily seeds the six system folders on first call", async () => {
    const folders = await listFolders(householdId);
    expect(folders.map((f) => f.name)).toEqual([...SYSTEM_FOLDERS]);
    expect(folders.every((f) => f.isSystem)).toBe(true);
  });

  it("is idempotent — a second call does not duplicate", async () => {
    await listFolders(householdId);
    await listFolders(householdId);
    const rows = await db.query.crmDocumentFolders.findMany({
      where: eq(crmDocumentFolders.householdId, householdId),
    });
    expect(rows).toHaveLength(SYSTEM_FOLDERS.length);
  });
});
