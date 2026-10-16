import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  requireActiveSubscription,
  ForbiddenError as SubscriptionForbiddenError,
} from "@/lib/authz";
import { requireImportAccess, ForbiddenError, NotFoundError } from "@/lib/imports/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { attachClientDocument } from "@/lib/imports/client-documents";
import { refuseSavedFactFinderWithState } from "@/lib/imports/saved-fact-finder";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const attachBody = z.object({ documentId: z.string().uuid() });

/**
 * Add a file from the client's vault to this import.
 * The server copies the vault file in, so it never round-trips through the
 * advisor's browser (nor its 4.5 MB request cap). The pages that render the
 * upload box list the documents themselves (`listClientDocuments`).
 *
 * Same gate chain as the advisor's own upload (`../files/route.ts`), plus the
 * subscription check every new write route takes.
 */
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
    if (access.access !== "own") {
      return NextResponse.json({ error: "Cross-organization imports are not supported." }, { status: 403 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const rl = await checkImportRateLimit(firmId, "upload");
    if (!rl.allowed) {
      const exceeded = rl.reason === "exceeded";
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)));
      }
      return NextResponse.json(
        {
          error: exceeded
            ? "Too many upload requests. Please wait and try again."
            : "Rate limiting is unavailable — file uploads are disabled. Please retry in a moment.",
        },
        { status: exceeded ? 429 : 503, headers },
      );
    }

    const imp = await requireImportAccess({ importId, clientId, firmId, userId });

    // A fact finder import saved to the plan is read-only.
    const savedRefusal = refuseSavedFactFinderWithState(imp);
    if (savedRefusal) return savedRefusal;

    const parsed = attachBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Pick a document to add." }, { status: 400 });
    }

    const result = await attachClientDocument({
      importId,
      clientId,
      firmId,
      documentId: parsed.data.documentId,
    });
    if (result.ok) return NextResponse.json({ file: result.file, deduped: result.deduped });
    switch (result.reason) {
      case "not_found":
        return NextResponse.json({ error: "That document is no longer available." }, { status: 404 });
      case "too_large":
        return NextResponse.json({ error: "File too large. Maximum size is 20MB." }, { status: 413 });
      case "unsupported_type":
        return NextResponse.json(
          { error: "The import can't read this file type. It takes PDF, Word, Excel, CSV, PNG or JPEG." },
          { status: 400 },
        );
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // `@/lib/authz`'s ForbiddenError (subscription) is a different class from
    // `@/lib/imports/authz`'s — both are a 403, never a 500.
    if (err instanceof ForbiddenError || err instanceof SubscriptionForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const safeMessage = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error("POST /api/clients/[id]/imports/[importId]/client-documents failed:", safeMessage);
    return NextResponse.json({ error: "Couldn't add that document. Please try again." }, { status: 500 });
  }
}
