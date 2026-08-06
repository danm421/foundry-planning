import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms, crmHouseholds, clients, crmHouseholdDocuments } from "@/db/schema";
import { ensureIntakeFolder } from "@/lib/crm/folders";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/crm/document-constants";
import { sanitizeFilename, STORAGE_PROVIDER } from "@/lib/crm/documents";
import { validateDocumentUpload } from "@/lib/files/content-type";
import { toSafeDisplayFilename } from "@/lib/files/safe-filename";
import { recordAudit } from "@/lib/audit";

/**
 * Client-uploaded intake documents.
 *
 * The public intake path has NO Clerk session, so this module cannot call
 * requireVaultAccess() or auth() the way src/lib/crm/documents.ts does. It
 * carries its own authorization instead — the caller (the route) has already
 * proven the identity gate — and reuses only the low-level primitives. This
 * mirrors the portal-vault precedent (src/lib/portal/vault-documents.ts):
 * a thin parallel module beats making audited advisor code dual-tenant.
 */

/** Household display name for a prospect whose real contacts don't exist yet.
 *  applyIntake later overwrites this via syncHouseholdNameFromContacts. */
export function placeholderHouseholdName(
  recipientName: string | null,
  recipientEmail: string,
): string {
  const trimmed = recipientName?.trim();
  if (trimmed) return `${trimmed} Household`;
  return `${recipientEmail.split("@")[0]} Household`;
}

/**
 * Resolve the household an intake form's documents belong to, minting one for a
 * prospect form on first use.
 *
 * The whole thing runs under a row lock on the form. Intake decision D6 gives
 * client and spouse ONE shared token, so two simultaneous first uploads are a
 * real scenario — without the lock they would mint two households for one form.
 * The loser blocks, then observes the winner's id under `crmHouseholdId`.
 */
export async function resolveIntakeHousehold(formId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [form] = await tx
      .select({
        firmId: intakeForms.firmId,
        clientId: intakeForms.clientId,
        crmHouseholdId: intakeForms.crmHouseholdId,
        createdByUserId: intakeForms.createdByUserId,
        recipientName: intakeForms.recipientName,
        recipientEmail: intakeForms.recipientEmail,
      })
      .from(intakeForms)
      .where(eq(intakeForms.id, formId))
      .for("update");

    if (!form) throw new Error(`Intake form ${formId} not found`);

    // Existing client: the household already exists; never park it on the form.
    if (form.clientId) {
      const [client] = await tx
        .select({ crmHouseholdId: clients.crmHouseholdId })
        .from(clients)
        .where(eq(clients.id, form.clientId));
      if (!client?.crmHouseholdId) {
        throw new Error(`Client ${form.clientId} has no CRM household`);
      }
      return client.crmHouseholdId;
    }

    if (form.crmHouseholdId) return form.crmHouseholdId;

    const [household] = await tx
      .insert(crmHouseholds)
      .values({
        firmId: form.firmId,
        advisorId: form.createdByUserId,
        name: placeholderHouseholdName(form.recipientName, form.recipientEmail),
        // false so applyIntake's syncHouseholdNameFromContacts re-derives the
        // real name from actual contacts — the placeholder must not stick.
        nameIsCustom: false,
        // status defaults to "prospect" — correct for this path.
      })
      .returning({ id: crmHouseholds.id });

    await tx
      .update(intakeForms)
      .set({ crmHouseholdId: household.id, updatedAt: new Date() })
      .where(eq(intakeForms.id, formId));

    return household.id;
  });
}

/**
 * Non-minting counterpart to `resolveIntakeHousehold`. Reads-only lookups
 * (list, delete) must never mint a household just because a client opened a
 * page or an advisor peeked at a review panel — that would litter the CRM
 * with empty prospect households for every form nobody ever uploaded to.
 * Only `uploadIntakeDocument` gets to mint; everything else calls this and
 * treats `null` as "nothing here yet."
 */
export async function findIntakeHousehold(formId: string): Promise<string | null> {
  const [form] = await db
    .select({
      clientId: intakeForms.clientId,
      crmHouseholdId: intakeForms.crmHouseholdId,
    })
    .from(intakeForms)
    .where(eq(intakeForms.id, formId));

  if (!form) throw new Error(`Intake form ${formId} not found`);

  if (form.clientId) {
    const [client] = await db
      .select({ crmHouseholdId: clients.crmHouseholdId })
      .from(clients)
      .where(eq(clients.id, form.clientId));
    if (!client?.crmHouseholdId) {
      throw new Error(`Client ${form.clientId} has no CRM household`);
    }
    return client.crmHouseholdId;
  }

  return form.crmHouseholdId ?? null;
}

async function firmIdForForm(formId: string): Promise<string> {
  const [row] = await db
    .select({ firmId: intakeForms.firmId })
    .from(intakeForms)
    .where(eq(intakeForms.id, formId));
  if (!row) throw new Error(`Intake form ${formId} not found`);
  return row.firmId;
}

/** Public surface — the 10MB per-file cap alone doesn't bound a form's total. */
export const MAX_INTAKE_FILES = 25;
export const MAX_INTAKE_TOTAL_BYTES = 50 * 1024 * 1024;

/** Single source of truth for the intake doc-type picker (Tasks 8/9 reuse this
 *  array; do not fork a second literal list — see Task 5 review). */
export const INTAKE_DOC_TYPES = [
  "statement",
  "paystub",
  "mortgage",
  "tax_return",
  "estate",
  "insurance",
  "other",
] as const;

export type IntakeDocType = (typeof INTAKE_DOC_TYPES)[number];

/** What the client is allowed to see: names, never locations. */
export interface IntakeDocumentView {
  id: string;
  filename: string;
  docType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
}

function toView(row: typeof crmHouseholdDocuments.$inferSelect): IntakeDocumentView {
  return {
    id: row.id,
    filename: row.filename,
    docType: row.description,
    sizeBytes: row.sizeBytes,
    uploadedAt: row.createdAt.toISOString(),
  };
}

export async function uploadIntakeDocument(
  formId: string,
  file: File,
  docType: IntakeDocType,
): Promise<IntakeDocumentView> {
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    throw new Error(
      `File too large. Maximum size is ${Math.floor(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))}MB.`,
    );
  }

  const firmId = await firmIdForForm(formId);
  const householdId = await resolveIntakeHousehold(formId);

  const [existing] = await db
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${crmHouseholdDocuments.sizeBytes}), 0)::bigint`,
    })
    .from(crmHouseholdDocuments)
    .where(
      and(
        eq(crmHouseholdDocuments.householdId, householdId),
        eq(crmHouseholdDocuments.sourceKind, "intake_upload"),
      ),
    );

  if (existing.count >= MAX_INTAKE_FILES) {
    throw new Error(`You've attached too many documents. The limit is ${MAX_INTAKE_FILES}.`);
  }
  // The aggregate comes back through raw sql, not a mapped schema column —
  // Postgres bigint sums arrive as a string over the wire; Number() it
  // explicitly rather than assume the driver already coerced it.
  if (Number(existing.bytes) + file.size > MAX_INTAKE_TOTAL_BYTES) {
    throw new Error("These documents exceed the total size limit for one form.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { mimeType } = validateDocumentUpload(file, buffer);

  const folderId = await ensureIntakeFolder(householdId, firmId);

  const safe = sanitizeFilename(file.name || "document");
  const displayName = toSafeDisplayFilename(file.name || "document");
  const storageKey = `crm/${householdId}/${Date.now()}-${randomUUID()}-${safe}`;

  const result = await put(storageKey, file, { access: "private", addRandomSuffix: false });

  const [doc] = await db
    .insert(crmHouseholdDocuments)
    .values({
      householdId,
      filename: displayName,
      storageProvider: STORAGE_PROVIDER,
      storageKey: result.pathname,
      mimeType,
      sizeBytes: file.size,
      // No Clerk user exists on the public intake path.
      uploadedBy: null,
      folderId,
      description: docType,
      sourceKind: "intake_upload",
    })
    .returning();

  await recordAudit({
    action: "intake.document.uploaded",
    resourceType: "crm_document",
    resourceId: doc.id,
    firmId,
    actorKind: "client",
    actorId: "system", // no Clerk session on the public intake flow
    metadata: { formId, filename: displayName, sizeBytes: file.size, docType },
  });

  return toView(doc);
}

export async function listIntakeDocuments(formId: string): Promise<IntakeDocumentView[]> {
  const householdId = await findIntakeHousehold(formId);
  if (!householdId) return [];

  const rows = await db
    .select()
    .from(crmHouseholdDocuments)
    .where(
      and(
        eq(crmHouseholdDocuments.householdId, householdId),
        eq(crmHouseholdDocuments.sourceKind, "intake_upload"),
      ),
    )
    .orderBy(desc(crmHouseholdDocuments.createdAt));
  return rows.map(toView);
}

/** Returns false (not a throw) when the target isn't the client's to delete —
 *  the route turns that into a 404 so nothing about other documents leaks. */
export async function deleteIntakeDocument(formId: string, docId: string): Promise<boolean> {
  const householdId = await findIntakeHousehold(formId);
  if (!householdId) return false;

  const [doc] = await db
    .select()
    .from(crmHouseholdDocuments)
    .where(
      and(
        eq(crmHouseholdDocuments.id, docId),
        eq(crmHouseholdDocuments.householdId, householdId),
        // Only ever the client's own intake uploads — never a file the advisor put here.
        eq(crmHouseholdDocuments.sourceKind, "intake_upload"),
      ),
    );
  if (!doc) return false;

  if (doc.storageKey) {
    try {
      await del(doc.storageKey);
    } catch {
      // Best-effort, matching the advisor path: a missing blob must not block
      // the row delete or the client is stuck with an undeletable entry.
    }
  }
  await db.delete(crmHouseholdDocuments).where(eq(crmHouseholdDocuments.id, docId));

  const firmId = await firmIdForForm(formId);
  await recordAudit({
    action: "intake.document.deleted",
    resourceType: "crm_document",
    resourceId: docId,
    firmId,
    actorKind: "client",
    actorId: "system", // no Clerk session on the public intake flow
    metadata: { formId, filename: doc.filename },
  });

  return true;
}
