import { NextRequest, NextResponse } from "next/server";
import { requireCrmHouseholdAccess } from "@/lib/crm/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkMeetingPrepRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { MeetingPrepSetupSchema } from "@/lib/crm/meeting-prep/schemas";
import { loadMeetingPrepBattery } from "@/lib/crm/meeting-prep/battery";
import { generateMeetingPrepDraft } from "@/lib/crm/meeting-prep/generate";

export const dynamic = "force-dynamic";
// Two mini-model calls + (possibly) a Monte Carlo compute-cache miss.
export const maxDuration = 120;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId } = await requireCrmHouseholdAccess(id);
    await requireActiveSubscriptionForFirm(orgId);

    const rl = await checkMeetingPrepRateLimit(orgId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many meeting-prep drafts. Please wait a moment and try again.",
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = MeetingPrepSetupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid setup" }, { status: 400 });
    }

    const battery = await loadMeetingPrepBattery(id, orgId, {
      windowStartOverride: parsed.data.windowStart,
    });
    const draft = await generateMeetingPrepDraft(battery, parsed.data);

    return NextResponse.json({ draft, data: battery });
  } catch (err) {
    // Mirrors the sibling `crm/households/[id]/*` routes (activity,
    // accounts, contacts, documents): `requireCrmHouseholdAccess` throws a
    // plain Error for a missing/inaccessible household, which
    // `authErrorResponse` below does NOT recognize (it only knows
    // UnauthorizedError/ForbiddenError) — so that case needs an explicit 404
    // branch ahead of it, or it would fall through to the 500 catch-all.
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    if (err instanceof Error && err.message === "ai_not_configured") {
      return NextResponse.json(
        { error: "AI is not configured for this environment." },
        { status: 503 },
      );
    }
    console.error("POST meeting-prep draft error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
