import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmDocumentFolders, crmHouseholdDocuments } from "@/db/schema";
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
import {
  listFolders,
  SYSTEM_FOLDERS,
  PORTAL_SHARED_FOLDER_NAME,
  createFolder,
  updateFolder,
  deleteFolder,
} from "../folders";

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
  it("lazily seeds the system folders + shared root on first call", async () => {
    const folders = await listFolders(householdId);
    // Order-tolerant for the shared root (its position among the seed folders
    // depends on a createdAt tie-break), but still exact-set: fails if a system
    // folder goes missing or an extra folder appears.
    expect(folders.map((f) => f.name).sort()).toEqual(
      [...SYSTEM_FOLDERS, PORTAL_SHARED_FOLDER_NAME].sort(),
    );
    expect(folders.every((f) => f.isSystem)).toBe(true);
  });

  it("is idempotent — a second call does not duplicate", async () => {
    await listFolders(householdId);
    await listFolders(householdId);
    const rows = await db.query.crmDocumentFolders.findMany({
      where: eq(crmDocumentFolders.householdId, householdId),
    });
    expect(rows).toHaveLength(SYSTEM_FOLDERS.length + 1);
  });
});

describe("createFolder", () => {
  it("creates a custom folder at root", async () => {
    await listFolders(householdId); // ensure seeded
    const folder = await createFolder(householdId, { name: "2026 Reviews" });
    expect(folder.name).toBe("2026 Reviews");
    expect(folder.isSystem).toBe(false);
    expect(folder.parentFolderId).toBeNull();
  });

  it("creates a nested folder under a parent", async () => {
    const [parent] = await listFolders(householdId);
    const child = await createFolder(householdId, {
      name: "Q1",
      parentFolderId: parent.id,
    });
    expect(child.parentFolderId).toBe(parent.id);
  });

  it("rejects an empty name", async () => {
    await expect(createFolder(householdId, { name: "  " })).rejects.toThrow();
  });
});

describe("updateFolder", () => {
  it("renames a custom folder", async () => {
    const f = await createFolder(householdId, { name: "Old" });
    const updated = await updateFolder(householdId, f.id, { name: "New" });
    expect(updated.name).toBe("New");
  });

  it("refuses to rename a system folder", async () => {
    const [plans] = await listFolders(householdId); // "Plans", isSystem
    await expect(
      updateFolder(householdId, plans.id, { name: "Renamed" }),
    ).rejects.toThrow(/system folder/i);
  });

  it("moves a folder under a new parent", async () => {
    const a = await createFolder(householdId, { name: "A" });
    const b = await createFolder(householdId, { name: "B" });
    const moved = await updateFolder(householdId, b.id, {
      parentFolderId: a.id,
    });
    expect(moved.parentFolderId).toBe(a.id);
  });

  it("rejects a move that would create a cycle (parent into its own descendant)", async () => {
    const a = await createFolder(householdId, { name: "A" });
    const b = await createFolder(householdId, { name: "B", parentFolderId: a.id });
    // Moving A under B (B is A's child) → cycle.
    await expect(
      updateFolder(householdId, a.id, { parentFolderId: b.id }),
    ).rejects.toThrow(/cycle|descendant/i);
  });

  it("rejects making a folder its own parent", async () => {
    const a = await createFolder(householdId, { name: "A" });
    await expect(
      updateFolder(householdId, a.id, { parentFolderId: a.id }),
    ).rejects.toThrow();
  });
});

describe("deleteFolder", () => {
  it("refuses to delete a system folder", async () => {
    const [plans] = await listFolders(householdId);
    await expect(deleteFolder(householdId, plans.id)).rejects.toThrow(
      /system folder/i,
    );
  });

  it("re-parents child folders to the grandparent on delete", async () => {
    const parent = await createFolder(householdId, { name: "Parent" });
    const mid = await createFolder(householdId, { name: "Mid", parentFolderId: parent.id });
    const child = await createFolder(householdId, { name: "Child", parentFolderId: mid.id });
    await deleteFolder(householdId, mid.id);
    const reloaded = await db.query.crmDocumentFolders.findFirst({
      where: eq(crmDocumentFolders.id, child.id),
    });
    expect(reloaded?.parentFolderId).toBe(parent.id); // grandparent
  });

  it("sets contained documents' folderId to null (fall to root)", async () => {
    const folder = await createFolder(householdId, { name: "Docs" });
    const [doc] = await db.insert(crmHouseholdDocuments).values({
      householdId,
      filename: "x.pdf",
      storageProvider: "vercel-blob",
      storageKey: "crm/x",
      folderId: folder.id,
    }).returning();
    await deleteFolder(householdId, folder.id);
    const reloaded = await db.query.crmHouseholdDocuments.findFirst({
      where: eq(crmHouseholdDocuments.id, doc.id),
    });
    expect(reloaded?.folderId).toBeNull();
  });
});
