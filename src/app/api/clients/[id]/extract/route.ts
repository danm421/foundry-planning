import { NextRequest, NextResponse } from "next/server";
import { getOrgId } from "@/lib/db-helpers";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { extractDocument } from "@/lib/extraction/extract";
import { DOCUMENT_TYPES } from "@/lib/extraction/types";
import type { DocumentType } from "@/lib/extraction/types";
import { checkExtractRateLimit } from "@/lib/rate-limit";

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
        { status: 400 }
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
    const result = await extractDocument(
      buffer,
      file.name,
      documentType as DocumentType | "auto",
      model
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/extract error:", err);
    return NextResponse.json(
      { error: "Extraction failed. Please try again." },
      { status: 500 }
    );
  }
}
