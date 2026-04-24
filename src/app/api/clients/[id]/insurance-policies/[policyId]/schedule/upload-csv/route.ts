import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { parseCashValueCsv } from "@/lib/insurance-policies/csv";

export const dynamic = "force-dynamic";

// Cash-value schedules are typically well under 200 rows; 256 KB is a
// comfortable ceiling that also blocks DoS via pathological uploads.
const MAX_CSV_SIZE = 256 * 1024;

// POST /api/clients/[id]/insurance-policies/[policyId]/schedule/upload-csv
// Parse-only endpoint. Accepts a multipart/form-data body with a `file`
// field, reads it as text, and returns the parser's `{ rows, errors }`
// result. The UI calls the sibling PATCH endpoint to persist rows after
// the user reviews them — this handler never writes to the database.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; policyId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, policyId } = await params;

    // Refuse oversize uploads before buffering the body. The client can
    // lie about Content-Length, so the real enforcement is the
    // `file.size` check below — this is just a cheap pre-filter.
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_CSV_SIZE + 4096) {
      return NextResponse.json(
        { error: "File too large (max 256 KB)" },
        { status: 413 },
      );
    }

    // Verify client belongs to this firm.
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Tenant-isolation: confirm the target account exists, belongs to
    // this client, and is a life-insurance account. Even though this
    // endpoint is parse-only, the check keeps it consistent with the
    // sibling policy routes and prevents it being used as an oracle for
    // probing account UUIDs across firms.
    const [target] = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, policyId),
          eq(accounts.clientId, id),
          eq(accounts.category, "life_insurance"),
        ),
      );
    if (!target) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_CSV_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 256 KB)" },
        { status: 413 },
      );
    }

    const text = await file.text();
    const result = parseCashValueCsv(text);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "POST /api/clients/[id]/insurance-policies/[policyId]/schedule/upload-csv error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
