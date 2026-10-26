import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription, ForbiddenError as SubscriptionForbiddenError } from "@/lib/authz";
import {
  requireImportAccess,
  ForbiddenError,
  NotFoundError,
} from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { refuseSavedFactFinderWithState } from "@/lib/imports/saved-fact-finder";
import { MAX_IMPORT_FILE_SIZE_BYTES } from "@/lib/imports/store-import-file";
import { parseBody } from "@/lib/schemas/common";
import { issueStagedUpload, stagingPrefix } from "@/lib/uploads/staged-upload";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ filename: z.string().trim().min(1).max(255) });

/** Step 1 of every import upload (`@/lib/uploads/staged-upload`): a one-file
 *  Blob token, capped at the import size limit, for the files route to read
 *  back. It runs the files route's checks so a refused import never stages,
 *  plus the subscription check every new write route takes. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; importId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    await requireActiveSubscription();
    const { userId } = await auth();
    if (!userId) throw new UnauthorizedError();
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

    const rl = await checkImportRateLimit(firmId, "upload");
    if (!rl.allowed) {
      let status: number;
      let message: string;
      switch (rl.reason) {
        case "unconfigured":
          status = 503;
          message = "Rate limiting is not configured — file uploads are disabled.";
          break;
        case "redis_error":
          status = 503;
          message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
          break;
        case "exceeded":
          status = 429;
          message = "Too many upload requests. Please wait and try again.";
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

    const imp = await requireImportAccess({ importId, clientId, firmId, userId });

    // A fact finder import saved to the plan is read-only.
    const savedRefusal = refuseSavedFactFinderWithState(imp);
    if (savedRefusal) return savedRefusal;

    const parsed = await parseBody(BodySchema, request);
    if (!parsed.ok) return parsed.response;

    return NextResponse.json(
      await issueStagedUpload(
        stagingPrefix("imports", clientId),
        parsed.data.filename,
        MAX_IMPORT_FILE_SIZE_BYTES,
      ),
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // `@/lib/authz`'s ForbiddenError (subscription) is a different class from
    // `@/lib/imports/authz`'s — a lapsed subscription is a 403, never a 500.
    if (err instanceof SubscriptionForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(
      "POST /api/clients/[id]/imports/[importId]/files/upload-token failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}
