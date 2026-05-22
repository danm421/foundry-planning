import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmTaskAccess } from "@/lib/crm/authz";
import { checkImportRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { listCrmTaskFiles, uploadCrmTaskFile, MAX_SIZE_BYTES } from "@/lib/crm-tasks/files";
import { mapCrmTaskError } from "@/lib/crm-tasks/route-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    await requireCrmTaskAccess(taskId);
    const files = await listCrmTaskFiles(taskId);
    return NextResponse.json({ files });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { taskId } = await params;
    // Scope-check before consuming rate-limit budget so callers poking at
    // other firms' tasks can't burn down our buckets.
    await requireCrmTaskAccess(taskId);

    const rl = await checkImportRateLimit(firmId, "upload");
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Task file upload rate limit exceeded");
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_SIZE_BYTES + 65536) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${Math.floor(MAX_SIZE_BYTES / (1024 * 1024))}MB.` },
        { status: 413 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${Math.floor(MAX_SIZE_BYTES / (1024 * 1024))}MB.` },
        { status: 413 },
      );
    }

    const row = await uploadCrmTaskFile({
      taskId,
      firmId,
      uploadedByUserId: userId,
      file,
    });
    return NextResponse.json({ file: row }, { status: 201 });
  } catch (err) {
    return mapCrmTaskError(err);
  }
}
