import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmDocumentFolders } from "@/db/schema";
import { and, eq } from "drizzle-orm";

vi.mock("@/lib/db-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: vi.fn().mockResolvedValue("org_shared_test") };
});
vi.mock("@clerk/nextjs/server", async () => {
  const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>("@clerk/nextjs/server");
  return { ...actual, auth: vi.fn() };
});

import { auth } from "@clerk/nextjs/server";
import { ensureSharedFolder, listFolders, PORTAL_SHARED_FOLDER_NAME } from "../folders";

const ORG = "org_shared_test";
let householdId: string;

beforeEach(async () => {
  vi.mocked(auth).mockResolvedValue({ userId: "user_shared", orgId: ORG, orgRole: "org:admin" } as never);
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db.insert(crmHouseholds)
    .values({ firmId: ORG, advisorId: "user_shared", name: "HH" }).returning();
  householdId = h.id;
});

describe("ensureSharedFolder", () => {
  it("creates the shared root once and is idempotent", async () => {
    const a = await ensureSharedFolder(householdId, ORG);
    const b = await ensureSharedFolder(householdId, ORG);
    expect(a).toBe(b);
    const rows = await db.query.crmDocumentFolders.findMany({
      where: and(eq(crmDocumentFolders.householdId, householdId), eq(crmDocumentFolders.isPortalRoot, true)),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(PORTAL_SHARED_FOLDER_NAME);
    expect(rows[0].isSystem).toBe(true);
  });

  it("listFolders includes the shared root", async () => {
    const names = (await listFolders(householdId)).map((f) => f.name);
    expect(names).toContain(PORTAL_SHARED_FOLDER_NAME);
  });
});
