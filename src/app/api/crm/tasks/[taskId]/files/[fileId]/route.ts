import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { get } from "@vercel/blob";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmTaskAccess } from "@/lib/crm/authz";
import { deleteCrmTaskFile, getCrmTaskFileRow } from "@/lib/crm-tasks/files";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string; fileId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId, fileId } = await params;
    await requireCrmTaskAccess(taskId);

    await deleteCrmTaskFile({ fileId, taskId, firmId, userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string; fileId: string }> },
) {
  try {
    const { taskId, fileId } = await params;
    const { orgId } = await requireCrmTaskAccess(taskId);

    const row = await getCrmTaskFileRow(fileId, taskId);
    if (!row) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    // Legacy rows stored a public URL; they can't be served from the private
    // store. None exist (zero rows at migration time) — this is a guard.
    if (/^https?:\/\//.test(row.storageKey)) {
      return NextResponse.json({ error: "File is no longer available" }, { status: 410 });
    }

    const result = await get(row.storageKey, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "File blob not available" }, { status: 404 });
    }

    await recordAudit({
      action: "crm.task.file_downloaded",
      resourceType: "crm_task",
      resourceId: taskId,
      firmId: orgId,
      metadata: { fileId, filename: row.filename },
    });

    const safeFilename = row.filename.replace(/[\r\n"]/g, "_");
    return new Response(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType ?? row.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
