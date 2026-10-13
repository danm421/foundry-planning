import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { refuseUnlessAiImportEntitled } from "@/lib/imports/ai-import-gate";
import { parseBody } from "@/lib/schemas/common";
import { issueStagedUpload, stagingPrefix } from "@/lib/uploads/staged-upload";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ filename: z.string().trim().min(1).max(255) });

/** Step 1 of every tax analyzer upload (`@/lib/uploads/staged-upload`): a
 *  one-file Blob token, for the year or documents route to read back. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId, sessionClaims } = await auth();
    if (!userId) throw new UnauthorizedError();
    const { id: clientId } = await params;

    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.access !== "own" || access.permission !== "edit") {
      return NextResponse.json({ error: "Edit access required" }, { status: 403 });
    }

    const denied = await refuseUnlessAiImportEntitled({
      sessionClaims,
      firmId,
      clientId,
      metadata: { surface: "tax_returns_upload" },
    });
    if (denied) return denied;

    const parsed = await parseBody(BodySchema, request);
    if (!parsed.ok) return parsed.response;

    return NextResponse.json(
      await issueStagedUpload(stagingPrefix("tax-returns", clientId), parsed.data.filename),
    );
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/tax-returns/upload-token error:", err);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
