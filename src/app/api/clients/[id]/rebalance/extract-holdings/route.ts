import { NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { extractDocument } from "@/lib/extraction/extract";
import { normalizeExtractedHolding } from "@/lib/extraction/normalize-holdings";
import { detectUploadKind, MAX_UPLOAD_BYTES } from "@/lib/extraction/validate-upload";
import type { AdHocHoldingInput } from "@/lib/investments/rebalance/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** One account found on the statement, with the positions we could read off it. */
interface ExtractedPortfolio {
  name: string;
  /** True when the statement's account category is taxable — seeds the tax toggle. */
  taxable: boolean;
  holdings: AdHocHoldingInput[];
}

export interface ExtractHoldingsResponse {
  accounts: ExtractedPortfolio[];
  warnings: string[];
}

/**
 * Read holdings off an uploaded statement for the Rebalance tab's outside
 * portfolio. Deliberately stateless: nothing is written to blob storage, no
 * import row is created, and the client's accounts are untouched — the whole
 * point of an outside portfolio is that it never enters the plan.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await params;

    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
    await requireActiveSubscriptionForFirm(access.firmId);

    // Extraction is the expensive, externally-billed step — same limiter the
    // import flow uses. It fails closed when Upstash is unconfigured.
    const rl = await checkImportRateLimit(firmId, "extract");
    if (!rl.allowed) {
      const { status, message } =
        rl.reason === "exceeded"
          ? { status: 429, message: "Too many extraction requests. Please wait and try again." }
          : rl.reason === "redis_error"
            ? { status: 503, message: "Rate limiting is temporarily unavailable. Please retry in a moment." }
            : { status: 503, message: "Rate limiting is not configured — extraction is disabled." };
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)));
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    // Reject on the declared length before buffering the body, then again on the
    // real size — the header is client-controlled and unsafe to trust alone.
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 65536) {
      return NextResponse.json({ error: "File too large. Maximum size is 25MB." }, { status: 413 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large. Maximum size is 25MB." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const kind = detectUploadKind(buffer);
    if (!kind) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload a PDF, Word, Excel, CSV, or image (PNG/JPEG) file." },
        { status: 400 },
      );
    }

    const result = await extractDocument(
      buffer,
      file.name,
      "account_statement",
      "mini",
      kind,
      /* extractHoldings */ true,
    );

    const accounts: ExtractedPortfolio[] = result.extracted.accounts
      .map((a) => ({
        name: a.name,
        taxable: a.category === "taxable",
        holdings: (a.holdings ?? []).map(normalizeExtractedHolding),
      }))
      .filter((a) => a.holdings.length > 0);

    await recordAudit({
      action: "rebalance.holdings.extracted",
      resourceType: "client",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: {
        fileName: file.name,
        kind,
        accountCount: accounts.length,
        holdingCount: accounts.reduce((s, a) => s + a.holdings.length, 0),
      },
    });

    const warnings = [...result.warnings];
    if (accounts.length === 0) {
      warnings.push("No holdings could be read off this document.");
    }

    return NextResponse.json({ accounts, warnings } satisfies ExtractHoldingsResponse);
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/rebalance/extract-holdings error:", err);
    return NextResponse.json({ error: "Could not read holdings from that file." }, { status: 500 });
  }
}
