import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImports, clientImportFiles } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; importId: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { id: clientId, importId } = await params;

    // requireImportAccess filters out already-discarded imports
    // (isNull(discardedAt)), so a re-discard of a tombstoned row hits
    // NotFoundError → 404 from the catch block. Idempotent via 404
    // rather than 200, which is consistent with how the file delete
    // route treats hidden rows.
    const imp = await requireImportAccess({
      importId,
      clientId,
      firmId,
      userId,
    });

    if (imp.status === "committed") {
      return NextResponse.json(
        { error: "cannot_discard_committed_import" },
        { status: 409 },
      );
    }

    // Defensive — requireImportAccess already filters discardedAt,
    // but if a future change loosens that, this branch keeps the
    // endpoint idempotent rather than double-stamping the timestamp.
    if (imp.discardedAt) {
      return NextResponse.json({ ok: true, alreadyDiscarded: true });
    }

    // Atomic cascade: flip the import + soft-delete its files in one
    // transaction so a partial failure can't leave files orphaned on a
    // live import (or vice-versa). The file UPDATE is also conditional
    // on deletedAt IS NULL to avoid clobbering existing tombstones from
    // earlier per-file deletes.
    const fileCountSoftDeleted = await db.transaction(async (tx) => {
      await tx
        .update(clientImports)
        .set({ discardedAt: new Date(), status: "discarded" })
        .where(eq(clientImports.id, importId));

      const softDeleted = await tx
        .update(clientImportFiles)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(clientImportFiles.importId, importId),
            isNull(clientImportFiles.deletedAt),
          ),
        )
        .returning({ id: clientImportFiles.id });

      return softDeleted.length;
    });

    await recordAudit({
      action: "import.discarded",
      resourceType: "client_import",
      resourceId: importId,
      clientId,
      firmId,
      metadata: { fileCountSoftDeleted },
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
      "POST /api/clients/[id]/imports/[importId]/discard failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Failed to discard import." },
      { status: 500 },
    );
  }
}
