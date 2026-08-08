import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { checkImportRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import {
  buildPreview,
  sanitizeMapping,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
} from "@/lib/crm/import";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_COLUMNS = 200;

// `mapping` is validated loosely and then sanitized in code: an out-of-range
// or unknown entry drops silently rather than 400ing a whole re-map, which is
// what a stale client would otherwise do to an advisor mid-edit.
const bodySchema = z.object({
  dataRows: z
    .array(z.array(z.union([z.string(), z.number()])).max(MAX_COLUMNS))
    .max(MAX_IMPORT_ROWS),
  mapping: z.record(z.string(), z.number()),
  overrides: z
    .array(
      z.object({
        rowIndex: z.number().int().min(0).max(MAX_IMPORT_ROWS),
        field: z.enum(IMPORT_FIELDS),
        value: z.string().max(500),
      }),
    )
    .max(5000)
    .default([]),
});

/**
 * Re-derive an import preview from an already-uploaded grid after the advisor
 * corrects the column mapping or fixes a cell. Stateless by design — the
 * client holds the grid, so nothing is persisted between upload and commit.
 */
export async function POST(req: NextRequest) {
  try {
    const firmId = await requireOrgId();

    const rl = await checkImportRateLimit(firmId, "view");
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Import preview rate limit exceeded");
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { dataRows, mapping, overrides } = parsed.data;
    const columnCount = dataRows.reduce((max, r) => Math.max(max, r.length), 0);
    const preview = await buildPreview(
      dataRows,
      sanitizeMapping(mapping, Math.max(columnCount, MAX_COLUMNS)),
      overrides,
    );

    return NextResponse.json({ preview });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const safeMessage = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error("POST /api/crm/import/remap failed:", safeMessage);
    return NextResponse.json(
      { error: "Could not rebuild the preview. Please try again." },
      { status: 500 },
    );
  }
}
