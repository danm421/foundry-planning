import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { crmHouseholdDocuments, crmDocumentFolders, clientImportFiles } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireVaultAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";
import { MAX_DOCUMENT_SIZE_BYTES } from "./document-constants";
import { validateDocumentUpload } from "@/lib/files/content-type";

/**
 * CRM household document storage. Mirrors `src/lib/imports/blob.ts` but
 * persists a DB row per upload so the documents tab can list, download,
 * and delete prior uploads. Filenames are sanitized to a shell-safe
 * subset and namespaced under `crm/<householdId>/` so listing a single
 * household's blobs is cheap.
 *
 * Blob URLs are intentionally NOT exposed to the client — the storage
 * key is what we persist, and downloads are streamed through the
 * `/api/crm/households/[id]/documents/[docId]` GET handler so access
 * stays org-scoped.
 */

const SAFE_FILENAME_RE = /[^A-Za-z0-9._-]/g;
const DOT_RUN_RE = /\.{2,}/g;

export { MAX_DOCUMENT_SIZE_BYTES } from "./document-constants";
/** @deprecated Use `MAX_DOCUMENT_SIZE_BYTES`. Kept as an alias for older imports. */
export const MAX_SIZE_BYTES = MAX_DOCUMENT_SIZE_BYTES;
export const STORAGE_PROVIDER = "vercel-blob";

function sanitizeFilename(name: string): string {
  return name.replace(SAFE_FILENAME_RE, "_").replace(DOT_RUN_RE, "_");
}

export type CrmDocumentRow = typeof crmHouseholdDocuments.$inferSelect;

export async function uploadCrmDocument(
  householdId: string,
  file: File,
  opts: { folderId?: string | null; description?: string | null } = {},
): Promise<CrmDocumentRow> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(
      `File too large. Maximum size is ${Math.floor(MAX_SIZE_BYTES / (1024 * 1024))}MB.`,
    );
  }

  const { orgId } = await requireVaultAccess(householdId);
  const { userId } = await auth();

  const buffer = Buffer.from(await file.arrayBuffer());
  const { mimeType } = validateDocumentUpload(file, buffer);

  const safe = sanitizeFilename(file.name || "document");
  // Include a random UUID segment so two uploads of the same filename
  // landing in the same millisecond can't collide with `addRandomSuffix: false`.
  const storageKey = `crm/${householdId}/${Date.now()}-${randomUUID()}-${safe}`;

  const result = await put(storageKey, file, {
    access: "private",
    addRandomSuffix: false,
  });

  const [doc] = await db
    .insert(crmHouseholdDocuments)
    .values({
      householdId,
      filename: file.name,
      storageProvider: STORAGE_PROVIDER,
      // Persist the pathname (not the public-looking URL) so all reads
      // go back through the SDK — never embed the blob URL.
      storageKey: result.pathname,
      mimeType,
      sizeBytes: file.size,
      uploadedBy: userId ?? null,
      folderId: opts.folderId ?? null,
      description: opts.description ?? null,
      sourceKind: "upload",
    })
    .returning();

  await recordAudit({
    action: "crm.document.create",
    resourceType: "crm_document",
    resourceId: doc.id,
    firmId: orgId,
    metadata: {
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || null,
      folderId: opts.folderId ?? null,
    },
  });

  await recordActivity(
    {
      householdId,
      kind: "document_uploaded",
      title: `Uploaded document: ${file.name}`,
      metadata: { documentId: doc.id, sizeBytes: file.size },
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );

  return doc;
}

export async function listCrmDocuments(
  householdId: string,
  opts: { folderId?: string | null } = {},
): Promise<CrmDocumentRow[]> {
  await requireVaultAccess(householdId);
  // Collapse versioned plans to their current version — superseded generated
  // plans (is_current_version = false) never appear in the folder listing; the
  // version-history endpoint (`listDocumentVersions`) still returns the full set.
  const currentOnly = eq(crmHouseholdDocuments.isCurrentVersion, true);
  const folderScope =
    opts.folderId === undefined
      ? undefined
      : opts.folderId === null
        ? isNull(crmHouseholdDocuments.folderId)
        : eq(crmHouseholdDocuments.folderId, opts.folderId);
  const where = folderScope
    ? and(eq(crmHouseholdDocuments.householdId, householdId), currentOnly, folderScope)
    : and(eq(crmHouseholdDocuments.householdId, householdId), currentOnly);
  return db.query.crmHouseholdDocuments.findMany({
    where,
    orderBy: [desc(crmHouseholdDocuments.createdAt)],
  });
}

export async function getCrmDocument(
  documentId: string,
): Promise<CrmDocumentRow> {
  const doc = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.id, documentId),
  });
  if (!doc) {
    throw new Error("Document not found");
  }
  await requireVaultAccess(doc.householdId);
  return doc;
}

export async function deleteCrmDocument(documentId: string): Promise<void> {
  const doc = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.id, documentId),
  });
  if (!doc) {
    throw new Error("Document not found");
  }
  const { orgId } = await requireVaultAccess(doc.householdId);

  // Best-effort blob delete — if it 404s we still want the DB row gone.
  // storageKey is null for generated/import-ref docs (no blob to delete).
  // import_ref rows have no own blob — never delete the linked import file.
  if (doc.storageKey && doc.sourceKind !== "import_ref") {
    try {
      await del(doc.storageKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown";
      console.error("[crm.documents] failed to delete blob:", { storageKey: doc.storageKey, err: msg });
    }
  }

  await db
    .delete(crmHouseholdDocuments)
    .where(
      and(
        eq(crmHouseholdDocuments.id, documentId),
        eq(crmHouseholdDocuments.householdId, doc.householdId),
      ),
    );

  const { userId } = await auth();

  await recordAudit({
    action: "crm.document.delete",
    resourceType: "crm_document",
    resourceId: documentId,
    firmId: orgId,
    metadata: { filename: doc.filename },
  });

  await recordActivity(
    {
      householdId: doc.householdId,
      kind: "note",
      title: `Deleted document: ${doc.filename}`,
      metadata: { documentId, filename: doc.filename },
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
}

export async function updateCrmDocument(
  documentId: string,
  patch: { folderId?: string | null; filename?: string; description?: string | null },
): Promise<CrmDocumentRow> {
  const doc = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.id, documentId),
  });
  if (!doc) throw new Error("Document not found");
  const { orgId } = await requireVaultAccess(doc.householdId);

  // A destination folder must belong to the same household.
  if (patch.folderId) {
    const folder = await db.query.crmDocumentFolders.findFirst({
      where: and(
        eq(crmDocumentFolders.id, patch.folderId),
        eq(crmDocumentFolders.householdId, doc.householdId),
      ),
      columns: { id: true },
    });
    if (!folder) throw new Error("Destination folder not found in this household");
  }

  const updates: Partial<typeof crmHouseholdDocuments.$inferInsert> = {};
  if (patch.folderId !== undefined) updates.folderId = patch.folderId;
  if (patch.filename !== undefined) {
    const name = patch.filename.trim();
    if (!name) throw new Error("Filename is required");
    updates.filename = name;
  }
  if (patch.description !== undefined) updates.description = patch.description;

  const [updated] = await db
    .update(crmHouseholdDocuments)
    .set(updates)
    .where(
      and(
        eq(crmHouseholdDocuments.id, documentId),
        eq(crmHouseholdDocuments.householdId, doc.householdId),
      ),
    )
    .returning();

  await recordAudit({
    action: patch.folderId !== undefined ? "vault.document.move" : "vault.document.update",
    resourceType: "crm_document",
    resourceId: documentId,
    firmId: orgId,
    metadata: { folderId: patch.folderId, filename: patch.filename },
  });
  return updated;
}

export async function listDocumentVersions(
  documentId: string,
): Promise<CrmDocumentRow[]> {
  const doc = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.id, documentId),
  });
  if (!doc) throw new Error("Document not found");
  await requireVaultAccess(doc.householdId);
  if (!doc.versionGroupId) return [doc];
  return db.query.crmHouseholdDocuments.findMany({
    where: and(
      eq(crmHouseholdDocuments.householdId, doc.householdId),
      eq(crmHouseholdDocuments.versionGroupId, doc.versionGroupId),
    ),
    orderBy: [desc(crmHouseholdDocuments.versionNo)],
  });
}

/**
 * Where does this document's bytes live? Uploads and generated plans carry
 * their own `storageKey`. `import_ref` rows have a null storageKey and point
 * at a `client_import_files` row; a null result means the link is stale
 * (the underlying import file was discarded) → callers should 410.
 */
export async function resolveDocumentBlobPathname(
  doc: CrmDocumentRow,
): Promise<string | null> {
  if (doc.sourceKind === "import_ref") {
    if (!doc.importFileId) return null;
    const file = await db.query.clientImportFiles.findFirst({
      where: eq(clientImportFiles.id, doc.importFileId),
      columns: { blobPathname: true, deletedAt: true },
    });
    if (!file || file.deletedAt) return null;
    return file.blobPathname;
  }
  return doc.storageKey ?? null;
}
