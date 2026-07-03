import { NextRequest, NextResponse, after } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireCrmHouseholdAccess } from "@/lib/crm/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkMeetingPrepRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { MeetingPrepSetupSchema } from "@/lib/crm/meeting-prep/schemas";
import { loadMeetingPrepBattery } from "@/lib/crm/meeting-prep/battery";
import { generateMeetingPrepDraft } from "@/lib/crm/meeting-prep/generate";
import {
  createQueuedRun,
  listRecentRuns,
  markAnalyzing,
  markDone,
  markFailed,
  markRunning,
} from "@/lib/crm/generation-runs";

export const dynamic = "force-dynamic";
const LIST_LIMIT = 25;
// after() needs budget to finish generation past the 202: battery load (with a
// possible Monte Carlo compute-cache miss) + two mini-model calls — same budget
// as the sync draft route this replaces. Fluid Compute keeps the instance alive
// through after() up to maxDuration.
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
    const setup = parsed.data;

    const { userId } = await auth();
    let email: string | null = null;
    try {
      const u = await currentUser();
      email = u?.emailAddresses?.[0]?.emailAddress ?? null;
    } catch {
      // non-fatal — leave email null
    }

    // Meeting prep works for households with no planning client — clientId is
    // a nullable cross-reference, not a requirement.
    const [planningClient] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.crmHouseholdId, id), eq(clients.firmId, orgId)))
      .limit(1);

    const runId = await createQueuedRun({
      clientId: planningClient?.id ?? null,
      householdId: id,
      firmId: orgId,
      kind: "meeting-prep",
      scenarioId: null,
      triggeredBy: userId ?? null,
      triggeredByEmail: email,
      requestPayload: setup,
    });
    if (!runId) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    after(async () => {
      try {
        // Phase 1 — "Analyzing…": CRM battery + (possibly) a Monte Carlo
        // compute-cache miss.
        await markAnalyzing(runId);
        const battery = await loadMeetingPrepBattery(id, orgId, {
          windowStartOverride: setup.windowStart,
        });
        // Phase 2 — "Running": the two mini-model draft calls.
        await markRunning(runId);
        const draft = await generateMeetingPrepDraft(battery, setup);
        await markDone(runId, null, { draft, data: battery });
      } catch (err) {
        const msg =
          err instanceof Error && err.message === "ai_not_configured"
            ? "AI is not configured for this environment."
            : err instanceof Error
              ? err.message
              : "generation failed";
        console.error("[meeting-prep/runs] background generation failed", err);
        await markFailed(runId, msg);
      }
    });

    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    // requireCrmHouseholdAccess throws a plain Error for a missing household —
    // needs an explicit 404 branch ahead of authErrorResponse (which only
    // recognizes Unauthorized/Forbidden). Mirrors the sibling routes.
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST meeting-prep/runs error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { orgId } = await requireCrmHouseholdAccess(id);
    const rows = await listRecentRuns(id, orgId, LIST_LIMIT, { kind: "meeting-prep" });
    // Strip the heavy result payload — the panel needs status only; the detail
    // route serves the payload when a draft is actually opened.
    const runs = rows.map((row) => {
      const { resultPayload: _resultPayload, ...run } = row;
      void _resultPayload;
      return run;
    });
    return NextResponse.json(
      { runs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET meeting-prep/runs error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
