import { NextRequest, NextResponse, after } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkObservationsAiRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine/projection";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { buildObservationsFacts, generateObservationsDraft } from "@/lib/observations/draft";
import {
  createQueuedRun,
  markAnalyzing,
  markRunning,
  markDone,
  markFailed,
} from "@/lib/crm/generation-runs";

export const dynamic = "force-dynamic";
// after() needs budget to finish the background job past the 202: a
// projection + (possibly) a Monte Carlo compute-cache miss, then one
// structured-output LLM call — no PDF render. Must stay well below
// STALE_RUN_MS (generation-runs.ts, 15 min) or the reaper marks a
// still-running job "timed out".
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireOrgId();
    const { client, firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const rl = await checkObservationsAiRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many AI drafts. Please wait a moment and try again.",
      );
    }

    // crmHouseholdId is NOT NULL at the schema level; the guard is defensive
    // belt-and-braces, mirroring the other per-client runs routes.
    const householdId = client.crmHouseholdId;
    if (!householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const scenario =
      typeof (body as { scenario?: unknown })?.scenario === "string"
        ? (body as { scenario: string }).scenario
        : null;

    const { userId } = await auth();
    let email: string | null = null;
    try {
      const u = await currentUser();
      email = u?.emailAddresses?.[0]?.emailAddress ?? null;
    } catch {
      // non-fatal — leave email null
    }

    const runId = await createQueuedRun({
      clientId: id,
      householdId,
      firmId,
      kind: "observations-draft",
      scenarioId: null,
      triggeredBy: userId ?? null,
      triggeredByEmail: email,
      requestPayload: { scenario },
    });

    after(async () => {
      try {
        await markAnalyzing(runId);
        const { effectiveTree } = await loadEffectiveTree(id, firmId, scenario ?? "base", {});
        const projection = runProjectionWithEvents(effectiveTree);
        // Monte Carlo is best-effort here — a cache/compute failure shouldn't
        // block the draft. Never pass `trials`: the compute cache dedupes on
        // the canonical trial count.
        const mc = await getOrComputeMonteCarlo({
          clientId: id,
          firmId,
          scenarioId: scenario ?? "base",
        }).catch(() => null);
        await markRunning(runId);
        const facts = buildObservationsFacts({
          clientData: effectiveTree,
          projection,
          monteCarlo: mc?.payload.summary ?? null,
        });
        const draft = await generateObservationsDraft(facts);
        await markDone(runId, null, { suggestions: draft.suggestions });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "draft failed";
        console.error("[observations/draft-runs] background draft failed", err);
        await markFailed(runId, msg);
      }
    });

    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /clients/[id]/observations/draft-runs error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
