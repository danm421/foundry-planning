import "server-only";

import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { crmTaskActivity, crmTaskFiles } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { validateDocumentUpload } from "@/lib/files/content-type";

/**
 * Blob upload + record module for CRM task attachments. Mirrors the
 * shape of `src/lib/crm/documents.ts` — Blob `put` happens first, then
 * the DB row + activity row land in a single `db.transaction` so the
 * file-row and the activity feed can never get out of sync. The
 * firm-wide audit is written *outside* the transaction since
 * `recordAudit` swallows its own errors.
 *
 * Filenames are sanitized to a shell-safe subset and namespaced under
 * `crm-tasks/<firmId>/<taskId>/` so listing a single task's blobs is
 * cheap. Uploads go to the PRIVATE blob store (`access: "private"`, the
 * default `BLOB_READ_WRITE_TOKEN`) and we persist the private
 * `pathname` returned by `put` — not a public URL. The file is never
 * directly reachable; it's served through an authenticated proxy GET
 * that re-checks task scoping before streaming the blob. `del()`
 * accepts the stored pathname.
 *
 * Content is validated by magic bytes (`validateDocumentUpload`) before
 * anything is written, so the persisted `mimeType` is server-trusted
 * rather than the caller-supplied `file.type`.
 *
 * Callers pass `firmId`, `taskId`, and `uploadedByUserId` explicitly;
 * this module performs no auth (it stays out of Clerk territory so it
 * remains testable in isolation).
 */

const SAFE_FILENAME_RE = /[^A-Za-z0-9._-]/g;
const DOT_RUN_RE = /\.{2,}/g;

export const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const STORAGE_PROVIDER = "vercel-blob";

function sanitizeFilename(name: string): string {
  return name.replace(SAFE_FILENAME_RE, "_").replace(DOT_RUN_RE, "_");
}

export type CrmTaskFileRow = typeof crmTaskFiles.$inferSelect;

export async function uploadCrmTaskFile(args: {
  taskId: string;
  firmId: string;
  uploadedByUserId: string;
  file: File;
}): Promise<CrmTaskFileRow> {
  if (args.file.size > MAX_SIZE_BYTES) {
    throw new Error(
      `File too large. Maximum size is ${Math.floor(MAX_SIZE_BYTES / (1024 * 1024))}MB.`,
    );
  }

  const buffer = Buffer.from(await args.file.arrayBuffer());
  const { mimeType } = validateDocumentUpload(args.file, buffer);

  const safe = sanitizeFilename(args.file.name || "attachment");
  // Include a random UUID segment so two uploads of the same filename
  // landing in the same millisecond can't collide with
  // `addRandomSuffix: false`.
  const storageKey = `crm-tasks/${args.firmId}/${args.taskId}/${Date.now()}-${randomUUID()}-${safe}`;

  const result = await put(storageKey, args.file, {
    access: "private",
    addRandomSuffix: false,
  });

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(crmTaskFiles)
      .values({
        taskId: args.taskId,
        uploadedByUserId: args.uploadedByUserId,
        filename: args.file.name,
        storageProvider: STORAGE_PROVIDER,
        // Persist the PRIVATE blob pathname (not a public URL). The file
        // is fetched through an authenticated proxy GET that re-checks
        // task scoping; `del()` accepts the stored pathname directly.
        storageKey: result.pathname,
        mimeType,
        sizeBytes: args.file.size,
      })
      .returning();

    await tx.insert(crmTaskActivity).values({
      taskId: args.taskId,
      userId: args.uploadedByUserId,
      kind: "file_uploaded",
      payload: {
        fileId: row.id,
        filename: args.file.name,
        sizeBytes: args.file.size,
      },
    });

    return row;
  });

  await recordAudit({
    action: "crm.task.file_uploaded",
    resourceType: "crm_task",
    resourceId: args.taskId,
    firmId: args.firmId,
    metadata: {
      fileId: created.id,
      filename: args.file.name,
      sizeBytes: args.file.size,
      mimeType: args.file.type || null,
    },
  });

  return created;
}

export async function deleteCrmTaskFile(args: {
  fileId: string;
  taskId: string;
  firmId: string;
  userId: string;
}): Promise<void> {
  const [row] = await db
    .select()
    .from(crmTaskFiles)
    .where(eq(crmTaskFiles.id, args.fileId));

  if (!row || row.taskId !== args.taskId) {
    throw new Error("File not found or wrong task");
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(crmTaskFiles)
      .where(
        and(
          eq(crmTaskFiles.id, args.fileId),
          eq(crmTaskFiles.taskId, args.taskId),
        ),
      );

    await tx.insert(crmTaskActivity).values({
      taskId: args.taskId,
      userId: args.userId,
      kind: "file_deleted",
      payload: { fileId: args.fileId, filename: row.filename },
    });
  });

  // Best-effort blob delete — if it 404s we still want the DB row gone.
  try {
    await del(row.storageKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[crm-tasks.files] failed to delete blob:", {
      storageKey: row.storageKey,
      err: msg,
    });
  }

  await recordAudit({
    action: "crm.task.file_deleted",
    resourceType: "crm_task",
    resourceId: args.taskId,
    firmId: args.firmId,
    metadata: { fileId: args.fileId, filename: row.filename },
  });
}

export async function listCrmTaskFiles(
  taskId: string,
): Promise<CrmTaskFileRow[]> {
  return db.select().from(crmTaskFiles).where(eq(crmTaskFiles.taskId, taskId));
}

/**
 * Fetch a single attachment row, scoped to its task. Returns the row
 * only when BOTH the file id AND the task id match — so the proxy GET
 * can't be tricked into streaming another task's blob by id alone.
 */
export async function getCrmTaskFileRow(
  fileId: string,
  taskId: string,
): Promise<CrmTaskFileRow | null> {
  const [row] = await db
    .select()
    .from(crmTaskFiles)
    .where(and(eq(crmTaskFiles.id, fileId), eq(crmTaskFiles.taskId, taskId)));
  return row ?? null;
}
