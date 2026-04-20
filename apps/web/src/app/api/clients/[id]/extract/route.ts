import { NextRequest, NextResponse } from "next/server";
import { getOrgId } from "@/lib/db-helpers";
import { db } from "@foundry/db";
import { clients } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { extractDocument } from "@/lib/extraction/extract";
import { DOCUMENT_TYPES } from "@/lib/extraction/types";
import type { DocumentType } from "@/lib/extraction/types";
import { checkExtractRateLimit } from "@/lib/rate-limit";
import { detectUploadKind } from "@/lib/extraction/validate-upload";

export const dynamic = "force-dynamic";

// Next.js App Router: increase body size limit for file uploads (default is 1MB)
export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const rl = await checkExtractRateLimit(firmId);
    if (!rl.allowed) {
      const status = rl.reason === "unconfigured" ? 503 : 429;
      const message =
        rl.reason === "unconfigured"
          ? "Rate limiting is not configured — document extraction is disabled."
          : "Too many extraction requests. Please wait and try again.";
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)));
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    // Verify client access
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Refuse the request before buffering if the client advertised an
     // oversize body. Cheap filter for accidental / drive-by uploads; the
     // real enforcement is the file.size check below because a client can
     // lie about Content-Length.
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 65536) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20MB." },
        { status: 413 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentType = (formData.get("documentType") as string) ?? "auto";
    const model = (formData.get("model") as string) === "full" ? "full" as const : "mini" as const;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20MB." },
        { status: 413 }
      );
    }

    // Validate document type
    const validTypes = [...DOCUMENT_TYPES, "auto"];
    if (!validTypes.includes(documentType)) {
      return NextResponse.json(
        { error: `Invalid document type: ${documentType}` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Magic-byte check — reject files whose content doesn't match any of
     // the formats the extraction pipeline knows how to parse safely.
     // Previously the parser branch was picked from the user-supplied
     // filename extension alone.
    const kind = detectUploadKind(buffer);
    if (!kind) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF, Excel, or CSV file." },
        { status: 400 }
      );
    }

    const result = await extractDocument(
      buffer,
      file.name,
      documentType as DocumentType | "auto",
      model,
      kind
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Azure errors can carry endpoint / deployment / request-id detail in
     // their stack; log only a truncated message so that detail doesn't
     // end up in Vercel Runtime Logs.
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error("POST /api/clients/[id]/extract failed:", safeMessage);
    return NextResponse.json(
      { error: "Extraction failed. Please try again." },
      { status: 500 }
    );
  }
}
