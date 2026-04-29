import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImportFiles } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Backslash-escape `"` and `\` so a hostile original_filename can't break
// out of the Content-Disposition quoted-string. Filenames are still
// constrained server-side at upload time, but defense-in-depth is cheap.
function escapeQuotes(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type Params = { params: Promise<{ id: string; importId: string; fileId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      // requireOrgId already verified userId, but TS doesn't know that.
      throw new UnauthorizedError();
    }
    const { id: clientId, importId, fileId } = await params;

    await requireImportAccess({ importId, clientId, firmId, userId });

    const rl = await checkImportRateLimit(firmId, "view");
    if (!rl.allowed) {
      const status = rl.reason === "unconfigured" ? 503 : 429;
      const message =
        rl.reason === "unconfigured"
          ? "Rate limiting is not configured — file downloads are disabled."
          : "Too many download requests. Please wait and try again.";
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(
          Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
        );
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    const [row] = await db
      .select()
      .from(clientImportFiles)
      .where(
        and(
          eq(clientImportFiles.id, fileId),
          eq(clientImportFiles.importId, importId),
          isNull(clientImportFiles.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Server-mediated fetch: never hand the client a direct blob URL —
    // keeps access policy enforced through this route and audit-logged.
    const upstream = await fetch(row.blobUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Blob fetch failed" },
        { status: 502 },
      );
    }

    await recordAudit({
      action: "import.file.viewed",
      resourceType: "client_import_file",
      resourceId: fileId,
      clientId,
      firmId,
      metadata: { importId },
    });

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${escapeQuotes(row.originalFilename)}"`,
        "Cache-Control": "private, no-store",
      },
    });
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
      "GET /api/clients/[id]/imports/[importId]/files/[fileId] failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Download failed. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { id: clientId, importId, fileId } = await params;

    await requireImportAccess({ importId, clientId, firmId, userId });

    // No rate-limit on delete — low-cardinality action, and the
    // import-level discard endpoint covers cascade deletes anyway.

    // Look up without the deletedAt filter so we can distinguish
    // "never existed" (404) from "already soft-deleted" (idempotent ok).
    const [row] = await db
      .select({
        id: clientImportFiles.id,
        deletedAt: clientImportFiles.deletedAt,
      })
      .from(clientImportFiles)
      .where(
        and(
          eq(clientImportFiles.id, fileId),
          eq(clientImportFiles.importId, importId),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (row.deletedAt) {
      return NextResponse.json({ ok: true });
    }

    // Conditional update guards against clobbering an existing tombstone
    // if a concurrent delete races with this one.
    await db
      .update(clientImportFiles)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(clientImportFiles.id, fileId),
          isNull(clientImportFiles.deletedAt),
        ),
      );

    // NOTE: deliberately do NOT call deleteImportFile() (the blob hard
    // delete). Soft-delete preserves the audit trail; a future sweeper
    // job will hard-delete tombstoned blobs after a retention window.
    await recordAudit({
      action: "import.file.deleted",
      resourceType: "client_import_file",
      resourceId: fileId,
      clientId,
      firmId,
      metadata: { importId },
    });

    return NextResponse.json({ ok: true });
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
      "DELETE /api/clients/[id]/imports/[importId]/files/[fileId] failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Delete failed. Please try again." },
      { status: 500 },
    );
  }
}
