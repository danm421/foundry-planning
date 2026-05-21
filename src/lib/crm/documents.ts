import { put, del } from "@vercel/blob";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { crmHouseholdDocuments } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";

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

export const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const STORAGE_PROVIDER = "vercel-blob";

function sanitizeFilename(name: string): string {
  return name.replace(SAFE_FILENAME_RE, "_").replace(DOT_RUN_RE, "_");
}

export type CrmDocumentRow = typeof crmHouseholdDocuments.$inferSelect;

export async function uploadCrmDocument(
  householdId: string,
  file: File,
): Promise<CrmDocumentRow> {
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(
      `File too large. Maximum size is ${Math.floor(MAX_SIZE_BYTES / (1024 * 1024))}MB.`,
    );
  }

  const { orgId } = await requireCrmHouseholdAccess(householdId);
  const { userId } = await auth();

  const safe = sanitizeFilename(file.name || "document");
  const storageKey = `crm/${householdId}/${Date.now()}-${safe}`;

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
      mimeType: file.type || null,
      sizeBytes: file.size,
      uploadedBy: userId ?? null,
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
    },
  });

  await recordActivity({
    householdId,
    kind: "document_uploaded",
    title: `Uploaded document: ${file.name}`,
    metadata: { documentId: doc.id, sizeBytes: file.size },
    occurredAt: new Date(),
  });

  return doc;
}

export async function listCrmDocuments(
  householdId: string,
): Promise<CrmDocumentRow[]> {
  await requireCrmHouseholdAccess(householdId);
  return db.query.crmHouseholdDocuments.findMany({
    where: eq(crmHouseholdDocuments.householdId, householdId),
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
  await requireCrmHouseholdAccess(doc.householdId);
  return doc;
}

export async function deleteCrmDocument(documentId: string): Promise<void> {
  const doc = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.id, documentId),
  });
  if (!doc) {
    throw new Error("Document not found");
  }
  const { orgId } = await requireCrmHouseholdAccess(doc.householdId);

  // Best-effort blob delete — if it 404s we still want the DB row gone.
  try {
    await del(doc.storageKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[crm.documents] failed to delete blob:", { storageKey: doc.storageKey, err: msg });
  }

  await db
    .delete(crmHouseholdDocuments)
    .where(
      and(
        eq(crmHouseholdDocuments.id, documentId),
        eq(crmHouseholdDocuments.householdId, doc.householdId),
      ),
    );

  await recordAudit({
    action: "crm.document.delete",
    resourceType: "crm_document",
    resourceId: documentId,
    firmId: orgId,
    metadata: { filename: doc.filename },
  });

  await recordActivity({
    householdId: doc.householdId,
    kind: "note",
    title: `Deleted document: ${doc.filename}`,
    metadata: { documentId, filename: doc.filename },
    occurredAt: new Date(),
  });
}
