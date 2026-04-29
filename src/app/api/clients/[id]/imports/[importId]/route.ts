import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  clientImports,
  clientImportFiles,
  clientImportExtractions,
} from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const NOTES_MAX_LENGTH = 2000;

// Statuses the PATCH endpoint may set. Other transitions (committed,
// discarded, draft) are owned by their respective endpoints — exposing
// them here would let advisors bypass the dedicated commit/discard
// flows along with their audit trails.
const PATCHABLE_STATUSES = ["extracting", "review"] as const;
type PatchableStatus = (typeof PATCHABLE_STATUSES)[number];

type Params = { params: Promise<{ id: string; importId: string }> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

// State-machine guard for PATCH. Terminal states ("committed",
// "discarded") and the initial "draft" state are not reachable via
// PATCH — clients must use the dedicated endpoints. The transitions
// listed below are the only legal moves; everything else returns 409.
function isAllowedTransition(
  from: string,
  to: PatchableStatus,
): boolean {
  if (from === "draft" && (to === "extracting" || to === "review")) return true;
  if (from === "extracting" && to === "review") return true;
  // Idempotent re-PATCH to current status is allowed so the client can
  // safely retry after a network blip without flipping into 409.
  if (from === to) return true;
  return false;
}

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { id: clientId, importId } = await params;

    const rl = await checkImportRateLimit(firmId, "view");
    if (!rl.allowed) {
      const status = rl.reason === "unconfigured" ? 503 : 429;
      const message =
        rl.reason === "unconfigured"
          ? "Rate limiting is not configured — import access is disabled."
          : "Too many requests. Please wait and try again.";
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(
          Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
        );
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    const imp = await requireImportAccess({
      importId,
      clientId,
      firmId,
      userId,
    });

    const files = await db
      .select()
      .from(clientImportFiles)
      .where(
        and(
          eq(clientImportFiles.importId, importId),
          isNull(clientImportFiles.deletedAt),
        ),
      )
      .orderBy(desc(clientImportFiles.uploadedAt));

    // Pull all extractions for these files in one round-trip, then pick
    // the latest per file in JS. Cheaper than a per-file subquery and
    // avoids the window-function complexity for the typical n<=10 case.
    const extractions =
      files.length === 0
        ? []
        : await db
            .select()
            .from(clientImportExtractions)
            .where(
              inArray(
                clientImportExtractions.fileId,
                files.map((f) => f.id),
              ),
            )
            .orderBy(desc(clientImportExtractions.startedAt));

    const latestByFile = new Map<string, (typeof extractions)[number]>();
    for (const e of extractions) {
      if (!latestByFile.has(e.fileId)) latestByFile.set(e.fileId, e);
    }

    const filesWithExtraction = files.map((f) => ({
      ...f,
      latestExtraction: latestByFile.get(f.id) ?? null,
    }));

    return NextResponse.json({ import: imp, files: filesWithExtraction });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(
      "GET /api/clients/[id]/imports/[importId] failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Failed to load import." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { id: clientId, importId } = await params;

    // No rate-limit on PATCH — low-cardinality, advisor-driven, same
    // posture as POST. requireImportAccess already enforces ownership.
    const imp = await requireImportAccess({
      importId,
      clientId,
      firmId,
      userId,
    });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: "Body must be an object" },
        { status: 400 },
      );
    }

    const { payloadJson, notes, status } = body as {
      payloadJson?: unknown;
      notes?: unknown;
      status?: unknown;
    };

    if (payloadJson !== undefined && !isPlainObject(payloadJson)) {
      return NextResponse.json(
        { error: "payloadJson must be an object" },
        { status: 400 },
      );
    }

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 },
      );
    }

    if (typeof notes === "string" && notes.length > NOTES_MAX_LENGTH) {
      return NextResponse.json(
        { error: "notes_too_long" },
        { status: 400 },
      );
    }

    let nextStatus: PatchableStatus | undefined;
    if (status !== undefined) {
      if (
        typeof status !== "string" ||
        !(PATCHABLE_STATUSES as readonly string[]).includes(status)
      ) {
        return NextResponse.json(
          { error: "Invalid status; must be 'extracting' or 'review'" },
          { status: 400 },
        );
      }
      nextStatus = status as PatchableStatus;
      if (!isAllowedTransition(imp.status, nextStatus)) {
        return NextResponse.json(
          { error: "invalid_status_transition" },
          { status: 409 },
        );
      }
    }

    // Build the SET clause from whatever was actually supplied. Touching
    // updatedAt unconditionally is cheap and keeps GET ordering correct
    // even on metadata-only edits.
    const updates: Partial<typeof clientImports.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (payloadJson !== undefined) {
      updates.payloadJson = payloadJson as Record<string, unknown>;
    }
    if (notes !== undefined) {
      updates.notes = typeof notes === "string" ? notes : null;
    }
    if (nextStatus !== undefined) {
      updates.status = nextStatus;
    }

    const [updated] = await db
      .update(clientImports)
      .set(updates)
      .where(eq(clientImports.id, importId))
      .returning();

    const changedFields = Object.keys(updates).filter(
      (k) => k !== "updatedAt",
    );

    await recordAudit({
      action: "import.payload.edited",
      resourceType: "client_import",
      resourceId: importId,
      clientId,
      firmId,
      metadata: {
        fields: changedFields,
        ...(nextStatus ? { newStatus: nextStatus } : {}),
      },
    });

    return NextResponse.json({ import: updated });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(
      "PATCH /api/clients/[id]/imports/[importId] failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Failed to update import." },
      { status: 500 },
    );
  }
}
