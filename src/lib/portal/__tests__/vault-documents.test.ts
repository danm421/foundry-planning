import { it, expect, beforeEach, vi } from "vitest";
import { db } from "@/db";
import { crmHouseholds, crmDocumentFolders, crmHouseholdDocuments } from "@/db/schema";
import { eq } from "drizzle-orm";

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ pathname: "crm/hh/mock-key" }),
  del: vi.fn().mockResolvedValue(undefined),
}));

const ctx = { value: null as unknown };
vi.mock("../vault-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vault-context")>();
  return { ...actual, resolvePortalVaultContext: vi.fn(async () => ctx.value) };
});

// The rename test reaches recordUpdate → recordAudit → Clerk auth(), which has
// no request context under vitest. Audit behavior isn't under test here.
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: vi.fn(),
  recordDelete: vi.fn(),
  recordUpdate: vi.fn(),
}));

import { toSafeDisplayFilename } from "@/lib/files/safe-filename";
import { resolvePortalVaultContext, PortalVaultNotFoundError } from "../vault-context";
import {
  listPortalDocuments,
  deletePortalDocument,
  updatePortalDocument,
} from "../vault-documents";

const ORG = "org_vault_docs_test";
let householdId: string;
let rootId: string;
let siblingId: string;

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
  ctx.value = {
    clientId: "c1", mode: "client", clerkUserId: "user_client",
    householdId, firmId: ORG, sharedRootId: rootId,
    subtree: new Set([rootId]),
  };
  vi.mocked(resolvePortalVaultContext).mockResolvedValue(ctx.value as never);
});

it("lists only docs in the shared root", async () => {
  await db.insert(crmHouseholdDocuments).values([
    { householdId, filename: "a.pdf", storageProvider: "vercel-blob", storageKey: "crm/a", folderId: rootId },
    { householdId, filename: "secret.pdf", storageProvider: "vercel-blob", storageKey: "crm/s", folderId: siblingId },
  ]);
  const docs = await listPortalDocuments(null); // null → shared root
  expect(docs.map((d) => d.filename)).toEqual(["a.pdf"]);
});

it("refuses to delete a doc outside the subtree (404)", async () => {
  const [doc] = await db.insert(crmHouseholdDocuments)
    .values({ householdId, filename: "secret.pdf", storageProvider: "vercel-blob", storageKey: "crm/s", folderId: siblingId })
    .returning();
  await expect(deletePortalDocument(doc.id)).rejects.toThrow(PortalVaultNotFoundError);
});

it("sanitizes renamed filenames the same way uploads do", async () => {
  const [doc] = await db.insert(crmHouseholdDocuments)
    .values({ householdId, filename: "a.pdf", storageProvider: "vercel-blob", storageKey: "crm/a", folderId: rootId })
    .returning();
  const dirty = 'bad"na\r\nme.pdf'; // quote + CRLF → header-injection class
  const updated = await updatePortalDocument(doc.id, { filename: dirty });
  expect(updated.filename).toBe(toSafeDisplayFilename(dirty));
  expect(updated.filename).not.toMatch(/["\r\n]/);
  const row = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.id, doc.id),
  });
  expect(row?.filename).toBe(toSafeDisplayFilename(dirty));
});

it("refuses to move a doc to an out-of-subtree folder and leaves it in place", async () => {
  const [doc] = await db.insert(crmHouseholdDocuments)
    .values({ householdId, filename: "a.pdf", storageProvider: "vercel-blob", storageKey: "crm/a", folderId: rootId })
    .returning();
  await expect(
    updatePortalDocument(doc.id, { folderId: siblingId }),
  ).rejects.toThrow(PortalVaultNotFoundError);
  const row = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.id, doc.id),
  });
  expect(row?.folderId).toBe(rootId);
});
