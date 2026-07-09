import { it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmDocumentFolders, crmHouseholdDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";

const ctx = { value: null as unknown };
vi.mock("../vault-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vault-context")>();
  return { ...actual, resolvePortalVaultContext: vi.fn(async () => ctx.value) };
});

// recordCreate/recordUpdate/recordDelete reach Clerk auth() at runtime, which
// has no request context under vitest. Audit behavior isn't under test here —
// mocked exactly like vault-documents.test.ts to keep output pristine.
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: vi.fn(),
  recordDelete: vi.fn(),
  recordUpdate: vi.fn(),
}));

import { resolvePortalVaultContext, PortalVaultNotFoundError } from "../vault-context";
import { createPortalFolder, updatePortalFolder, deletePortalFolder } from "../vault-folders";

const ORG = "org_vault_folders_test";
let householdId: string; let rootId: string; let siblingId: string;

async function refreshCtx() {
  const folders = await db.query.crmDocumentFolders.findMany({ where: eq(crmDocumentFolders.householdId, householdId) });
  const { collectFolderSubtreeIds } = await import("@/lib/crm/folder-tree");
  ctx.value = {
    clientId: "c1", mode: "client", clerkUserId: "u",
    householdId, firmId: ORG, sharedRootId: rootId,
    subtree: new Set(collectFolderSubtreeIds(folders, rootId)),
  };
  vi.mocked(resolvePortalVaultContext).mockResolvedValue(ctx.value as never);
}

beforeEach(async () => {
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, ORG));
  const [h] = await db.insert(crmHouseholds).values({ firmId: ORG, advisorId: "u", name: "HH" }).returning();
  householdId = h.id;
  const [root] = await db.insert(crmDocumentFolders)
    .values({ householdId, firmId: ORG, name: "Shared with Client", isSystem: true, isPortalRoot: true })
    .returning({ id: crmDocumentFolders.id });
  rootId = root.id;
  const [sib] = await db.insert(crmDocumentFolders)
    .values({ householdId, firmId: ORG, name: "Transcripts", isSystem: true })
    .returning({ id: crmDocumentFolders.id });
  siblingId = sib.id;
  await refreshCtx();
});

it("creates a folder under the shared root by default", async () => {
  const f = await createPortalFolder({ name: "Statements", parentFolderId: null });
  expect(f.parentFolderId).toBe(rootId);
});

it("rejects creating under an out-of-subtree parent", async () => {
  await expect(createPortalFolder({ name: "X", parentFolderId: siblingId })).rejects.toThrow(PortalVaultNotFoundError);
});

it("refuses to rename the shared root", async () => {
  await expect(updatePortalFolder(rootId, { name: "Renamed" })).rejects.toThrow();
});

it("on delete, re-homes contained docs to the folder's parent (never vault root)", async () => {
  const child = await createPortalFolder({ name: "Old", parentFolderId: null });
  await refreshCtx();
  const [doc] = await db.insert(crmHouseholdDocuments)
    .values({ householdId, filename: "x.pdf", storageProvider: "vercel-blob", storageKey: "crm/x", folderId: child.id })
    .returning();
  await deletePortalFolder(child.id);
  const reloaded = await db.query.crmHouseholdDocuments.findFirst({ where: eq(crmHouseholdDocuments.id, doc.id) });
  expect(reloaded?.folderId).toBe(rootId); // parent, not null
});
