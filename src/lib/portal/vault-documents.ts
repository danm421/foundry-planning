import { randomUUID } from "node:crypto";
import { del, get, head } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdDocuments } from "@/db/schema";
import { MAX_DIRECT_UPLOAD_SIZE_BYTES } from "@/lib/crm/document-constants";
import {
  STORAGE_PROVIDER,
  sanitizeFilename,
  resolveDocumentBlobPathname,
  type CrmDocumentRow,
} from "@/lib/crm/documents";
import { SNIFF_BYTES, validateDocumentUpload } from "@/lib/files/content-type";
import { toSafeDisplayFilename } from "@/lib/files/safe-filename";
import { recordActivity } from "@/lib/crm/activity";
import { recordCreate, recordDelete, recordUpdate } from "@/lib/audit/record-helpers";
import type { EntitySnapshot, FieldLabels } from "@/lib/audit/types";
import {
  resolvePortalVaultContext,
  assertInSubtree,
  PortalVaultNotFoundError,
  type PortalVaultContext,
} from "./vault-context";

export type PortalDocDTO = {
  id: string;
  filename: string;
  description: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  createdAt: string;
  folderId: string | null;
};

function toDTO(d: CrmDocumentRow): PortalDocDTO {
  return {
    id: d.id,
    filename: d.filename,
    description: d.description,
    sizeBytes: d.sizeBytes,
    mimeType: d.mimeType,
    createdAt: d.createdAt.toISOString(),
    folderId: d.folderId,
  };
}

/** Fetch a doc scoped to the household and assert it lives in the subtree. */
async function requireDocInSubtree(
  ctx: PortalVaultContext,
  docId: string,
): Promise<CrmDocumentRow> {
  const doc = await db.query.crmHouseholdDocuments.findFirst({
    where: and(
      eq(crmHouseholdDocuments.id, docId),
      eq(crmHouseholdDocuments.householdId, ctx.householdId),
    ),
  });
  if (!doc) throw new PortalVaultNotFoundError();
  assertInSubtree(ctx.subtree, doc.folderId);
  return doc;
}

function actorKind(ctx: PortalVaultContext): "advisor" | "client" {
  return ctx.mode === "advisor" ? "advisor" : "client";
}
const viaPreview = (ctx: PortalVaultContext) => (ctx.mode === "advisor" ? { viaPreview: true } : undefined);

export async function listPortalDocuments(folderId: string | null): Promise<PortalDocDTO[]> {
  const ctx = await resolvePortalVaultContext();
  const target = folderId ?? ctx.sharedRootId;
  assertInSubtree(ctx.subtree, target);
  const rows = await db.query.crmHouseholdDocuments.findMany({
    where: and(
      eq(crmHouseholdDocuments.householdId, ctx.householdId),
      eq(crmHouseholdDocuments.folderId, target),
      eq(crmHouseholdDocuments.isCurrentVersion, true),
    ),
    orderBy: [desc(crmHouseholdDocuments.createdAt)],
  });
  return rows.map(toDTO);
}

// Portal uploads get their own folder; the file part is one path segment of
// exactly the shape step 1 issues, so a pathname echoed back by the browser
// can't climb (`/`, `\`, `..`) into another household's blobs.
const portalUploadPrefix = (householdId: string) => `crm/${householdId}/portal/`;
const ISSUED_FILE_PART = /^\d+-[0-9a-f-]{36}-[A-Za-z0-9._-]+$/;

/**
 * Step 1 of a portal upload. The browser sends the file straight to Blob (a
 * function request body caps at 4.5 MB), so the server only issues a token for
 * one fresh, non-overwritable pathname under this household. Blob itself
 * enforces the size cap on the upload.
 */
export async function preparePortalUpload(opts: {
  filename: string;
  folderId: string | null;
}): Promise<{ pathname: string; clientToken: string }> {
  const ctx = await resolvePortalVaultContext();
  assertInSubtree(ctx.subtree, opts.folderId ?? ctx.sharedRootId);
  const pathname = `${portalUploadPrefix(ctx.householdId)}${Date.now()}-${randomUUID()}-${sanitizeFilename(opts.filename)}`;
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname,
    maximumSizeInBytes: MAX_DIRECT_UPLOAD_SIZE_BYTES,
    // The SDK's own default is 30 seconds — too short for a large file.
    validUntil: Date.now() + 60 * 60 * 1000,
  });
  return { pathname, clientToken };
}

/** The leading bytes `detectDocumentKind` reads, without fetching the rest. */
async function readBlobHead(pathname: string): Promise<Buffer> {
  const res = await get(pathname, { access: "private", headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` } });
  if (!res?.stream) throw new PortalVaultNotFoundError();
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

/**
 * Step 2: file the uploaded blob as a document. The pathname comes back from
 * the browser, so it must be one step 1 could have issued for THIS household
 * and must not already back a document. The bytes are sniffed here, after the
 * fact; a rejected blob is deleted.
 */
export async function registerPortalUpload(opts: {
  pathname: string;
  filename: string;
  folderId: string | null;
}): Promise<PortalDocDTO> {
  const ctx = await resolvePortalVaultContext();
  const target = opts.folderId ?? ctx.sharedRootId;
  assertInSubtree(ctx.subtree, target);
  const prefix = portalUploadPrefix(ctx.householdId);
  if (!opts.pathname.startsWith(prefix) || !ISSUED_FILE_PART.test(opts.pathname.slice(prefix.length))) {
    throw new PortalVaultNotFoundError();
  }
  const taken = await db.query.crmHouseholdDocuments.findFirst({
    where: eq(crmHouseholdDocuments.storageKey, opts.pathname),
    columns: { id: true },
  });
  if (taken) throw new PortalVaultNotFoundError();
  const blob = await head(opts.pathname).catch(() => null);
  if (!blob) throw new PortalVaultNotFoundError();

  const leadingBytes = await readBlobHead(opts.pathname);
  let mimeType: string;
  try {
    ({ mimeType } = validateDocumentUpload({ type: blob.contentType }, leadingBytes));
  } catch (err) {
    await del(opts.pathname).catch(() => {});
    throw err;
  }

  const [doc] = await db.insert(crmHouseholdDocuments).values({
    householdId: ctx.householdId,
    filename: toSafeDisplayFilename(opts.filename),
    storageProvider: STORAGE_PROVIDER,
    storageKey: opts.pathname,
    mimeType,
    sizeBytes: blob.size,
    uploadedBy: ctx.clerkUserId,
    folderId: target,
    sourceKind: "upload",
  }).returning();

  await recordCreate({
    action: "portal.document.create",
    resourceType: "crm_document",
    resourceId: doc.id,
    clientId: ctx.clientId,
    firmId: ctx.firmId,
    actorKind: actorKind(ctx),
    extraMetadata: viaPreview(ctx),
    snapshot: { filename: doc.filename, sizeBytes: doc.sizeBytes, folderId: target },
  });
  await recordActivity(
    {
      householdId: ctx.householdId,
      kind: "document_uploaded",
      title: `Client uploaded document: ${doc.filename}`,
      metadata: { documentId: doc.id, sizeBytes: doc.sizeBytes, actorKind: actorKind(ctx) },
      occurredAt: new Date(),
    },
    { actorUserId: ctx.clerkUserId },
  );
  return toDTO(doc);
}

export async function getPortalDocumentForDownload(
  docId: string,
): Promise<{ pathname: string; filename: string; mimeType: string | null }> {
  const ctx = await resolvePortalVaultContext();
  const doc = await requireDocInSubtree(ctx, docId);
  const pathname = await resolveDocumentBlobPathname(doc);
  if (!pathname) throw new PortalVaultNotFoundError();
  return { pathname, filename: doc.filename, mimeType: doc.mimeType };
}

export async function deletePortalDocument(docId: string): Promise<void> {
  const ctx = await resolvePortalVaultContext();
  const doc = await requireDocInSubtree(ctx, docId);
  if (doc.storageKey) {
    try {
      await del(doc.storageKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown";
      console.error("[portal.vault] failed to delete blob:", { storageKey: doc.storageKey, err: msg });
    }
  }
  await db.delete(crmHouseholdDocuments).where(
    and(eq(crmHouseholdDocuments.id, docId), eq(crmHouseholdDocuments.householdId, ctx.householdId)),
  );
  await recordDelete({
    action: "portal.document.delete",
    resourceType: "crm_document",
    resourceId: docId,
    clientId: ctx.clientId,
    firmId: ctx.firmId,
    actorKind: actorKind(ctx),
    extraMetadata: viaPreview(ctx),
    snapshot: { filename: doc.filename },
  });
  await recordActivity(
    {
      householdId: ctx.householdId,
      kind: "note",
      title: `Client deleted document: ${doc.filename}`,
      metadata: { documentId: docId, filename: doc.filename, actorKind: actorKind(ctx) },
      occurredAt: new Date(),
    },
    { actorUserId: ctx.clerkUserId },
  );
}

const DOC_FIELD_LABELS: FieldLabels = {
  filename: { label: "Filename", format: "text" },
  folderId: { label: "Folder", format: "reference" },
};

export async function updatePortalDocument(
  docId: string,
  patch: { filename?: string; folderId?: string },
): Promise<PortalDocDTO> {
  const ctx = await resolvePortalVaultContext();
  const doc = await requireDocInSubtree(ctx, docId);
  const updates: Partial<typeof crmHouseholdDocuments.$inferInsert> = {};
  const before: EntitySnapshot = {};
  const after: EntitySnapshot = {};
  if (patch.folderId !== undefined) {
    assertInSubtree(ctx.subtree, patch.folderId); // destination must be in-subtree (non-null)
    updates.folderId = patch.folderId;
    before.folderId = doc.folderId;
    after.folderId = patch.folderId;
  }
  if (patch.filename !== undefined) {
    const trimmed = patch.filename.trim();
    if (!trimmed) throw new Error("Filename is required");
    // Stored display names feed Content-Disposition / zip entries downstream —
    // sanitize renames the same way uploads do. (toSafeDisplayFilename never
    // returns "": it falls back to "file" for degenerate input.)
    const name = toSafeDisplayFilename(trimmed);
    updates.filename = name;
    before.filename = doc.filename;
    after.filename = name;
  }
  if (Object.keys(updates).length === 0) throw new Error("Nothing to update");
  const [updated] = await db.update(crmHouseholdDocuments).set(updates).where(
    and(eq(crmHouseholdDocuments.id, docId), eq(crmHouseholdDocuments.householdId, ctx.householdId)),
  ).returning();
  await recordUpdate({
    action: "portal.document.update",
    resourceType: "crm_document",
    resourceId: docId,
    clientId: ctx.clientId,
    firmId: ctx.firmId,
    actorKind: actorKind(ctx),
    extraMetadata: viaPreview(ctx),
    before, after, fieldLabels: DOC_FIELD_LABELS,
  });
  return toDTO(updated);
}
