import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { discardImport } from "@/lib/fact-finder/import-lifecycle";

const committedRefusal = () => NextResponse.json({ error: "cannot_discard_committed_import" }, { status: 409 });

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

    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.firmId !== firmId) {
      return NextResponse.json({ error: "Cross-organization imports are not supported." }, { status: 403 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    // requireImportAccess filters out already-discarded imports
    // (isNull(discardedAt)), so a re-discard of a tombstoned row hits
    // NotFoundError → 404 from the catch block. Idempotent via 404
    // rather than 200, which is consistent with how the file delete
    // route treats hidden rows.
    await requireImportAccess({
      importId,
      clientId,
      firmId,
      userId,
    });

    // Atomic cascade: the import and its files in one transaction. A committed
    // import — also one a save commits while this waits — is never discarded.
    const outcome = await discardImport({ importId, clientId, firmId });
    if (outcome === "saved") return committedRefusal();
    // Defensive — requireImportAccess already filters discardedAt,
    // but if a future change loosens that, this branch keeps the
    // endpoint idempotent rather than double-stamping the timestamp.
    if (outcome === "already") {
      return NextResponse.json({ ok: true, alreadyDiscarded: true });
    }

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
