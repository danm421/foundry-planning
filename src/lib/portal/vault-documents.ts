import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdDocuments } from "@/db/schema";
import {
  MAX_DOCUMENT_SIZE_BYTES,
  STORAGE_PROVIDER,
  sanitizeFilename,
  resolveDocumentBlobPathname,
  type CrmDocumentRow,
} from "@/lib/crm/documents";
import { validateDocumentUpload } from "@/lib/files/content-type";
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

export async function uploadPortalDocument(
  file: File,
  opts: { folderId: string | null },
): Promise<PortalDocDTO> {
  const ctx = await resolvePortalVaultContext();
  const target = opts.folderId ?? ctx.sharedRootId;
  assertInSubtree(ctx.subtree, target);
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error(`File too large. Maximum size is ${Math.floor(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))}MB.`);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const { mimeType } = validateDocumentUpload(file, buffer);
  const safe = sanitizeFilename(file.name || "document");
  const displayName = toSafeDisplayFilename(file.name || "document");
  const storageKey = `crm/${ctx.householdId}/${Date.now()}-${randomUUID()}-${safe}`;
  const result = await put(storageKey, file, { access: "private", addRandomSuffix: false });

  const [doc] = await db.insert(crmHouseholdDocuments).values({
    householdId: ctx.householdId,
    filename: displayName,
    storageProvider: STORAGE_PROVIDER,
    storageKey: result.pathname,
    mimeType,
    sizeBytes: file.size,
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
    const name = patch.filename.trim();
    if (!name) throw new Error("Filename is required");
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
