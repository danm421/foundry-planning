import { NextRequest, NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { parseCsv, dryRun } from "@/lib/crm/import";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB — generous for a CSV

/**
 * Bulk-import preview endpoint. Accepts a CSV (or single-sheet xlsx)
 * upload and returns the dry-run result so the advisor can resolve
 * duplicates client-side before committing.
 *
 * Fail-closed semantics: rate-limit denials, missing org, and invalid
 * file types all return without writing to the DB. The only side effect
 * is the audit row.
 */
export async function POST(req: NextRequest) {
  try {
    const firmId = await requireOrgId();

    const rl = await checkImportRateLimit(firmId, "upload");
    if (!rl.allowed) {
      let status: number;
      let message: string;
      switch (rl.reason) {
        case "unconfigured":
          status = 503;
          message = "Rate limiting is not configured — bulk import is disabled.";
          break;
        case "redis_error":
          status = 503;
          message =
            "Rate limiting is temporarily unavailable. Please retry in a moment.";
          break;
        case "exceeded":
          status = 429;
          message = "Too many import requests. Please wait and try again.";
          break;
      }
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(
          Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
        );
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 65536) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 413 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let parsed;
    try {
      parsed = parseCsv(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to parse file";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const result = await dryRun(parsed.proposed, { errors: parsed.errors });

    await recordAudit({
      action: "crm.import.preview",
      resourceType: "crm_import",
      resourceId: `${firmId}:${Date.now()}`,
      firmId,
      metadata: {
        rows: parsed.proposed.length,
        duplicates: result.duplicates.length,
        errors: result.errors.length,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error("POST /api/crm/import/preview failed:", safeMessage);
    return NextResponse.json(
      { error: "Import preview failed. Please try again." },
      { status: 500 },
    );
  }
}
