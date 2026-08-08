import { NextRequest, NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { checkImportRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { readGrid, detectMapping, buildPreview, MAX_IMPORT_ROWS } from "@/lib/crm/import";
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
      return rateLimitErrorResponse(rl, "Import preview rate limit exceeded");
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

    let grid: (string | number)[][];
    try {
      grid = await readGrid(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to parse file";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (grid.length === 0) {
      return NextResponse.json({ error: "That file has no rows." }, { status: 400 });
    }

    const header = grid[0].map((h) => String(h ?? "").trim());
    const dataRows = grid.slice(1, MAX_IMPORT_ROWS + 1);
    const mapping = detectMapping(header);
    const preview = await buildPreview(grid.slice(1), mapping);

    await recordAudit({
      action: "crm.import.preview",
      resourceType: "crm_import",
      resourceId: `${firmId}:${Date.now()}`,
      firmId,
      metadata: {
        rows: preview.rows.length,
        duplicates: preview.duplicates.length,
        errorRows: preview.rows.filter((r) => r.errors.length > 0).length,
        mappedFields: Object.keys(mapping).length,
      },
    });

    return NextResponse.json({ file: { header, dataRows }, mapping, preview });
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
