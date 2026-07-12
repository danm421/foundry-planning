import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkObservationsAiRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { parseBody } from "@/lib/schemas/common";
import { observationPolishSchema } from "@/lib/schemas/observations";
import { polishObservationBody } from "@/lib/observations/polish";

export const dynamic = "force-dynamic";

// Synchronous, single-call rewrite — no generation_runs bookkeeping (that's
// for the heavier draft-runs flow, which fans out a projection + MC compute
// first).

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireOrgId();
    // firmId is the client's HOME firm (may differ from the caller's org on
    // a cross-firm share) — mirrors the draft-runs route's gate exactly.
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const rl = await checkObservationsAiRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many AI requests. Please wait a moment and try again.",
      );
    }

    const parsed = await parseBody(observationPolishSchema, request);
    if (!parsed.ok) return parsed.response;

    const rewritten = await polishObservationBody(parsed.data.body);
    return NextResponse.json({ body: rewritten });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/observations/polish error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
