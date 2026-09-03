import { NextRequest, NextResponse, after } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { planObservationContext, scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkObservationsAiRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine/projection";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { draftRunRequestSchema } from "@/lib/schemas/observations";
import { loadScenarioChangesContext } from "@/lib/scenario/load-scenario-changes-context";
import { describeAndGroup } from "@/lib/presentations/pages/scenario-changes/view-model";
import { listInvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import {
  buildObservationsFacts,
  draftFailureMessage,
  generateObservationsDraft,
  type ObservationsFactsExtras,
} from "@/lib/observations/draft";
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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }
    const parsed = draftRunRequestSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "section must be observation or next_step" }, { status: 400 });
    }
    const { section } = parsed.data;

    // What the run resolves its figures against, and what it is told beyond
    // the figures. The section-specific inputs come from the context row —
    // never the body — so the generator and the panel cannot disagree about
    // what was used. Absent section = the Details panel's both-sections draft,
    // exactly as before.
    let scenarioId: string = parsed.data.scenario ?? "base";
    let proposedScenario: { id: string; name: string } | null = null;
    const extras: ObservationsFactsExtras = {};
    if (section) {
      const [ctxRow] = await db
        .select()
        .from(planObservationContext)
        .where(eq(planObservationContext.clientId, id));
      if (section === "next_step") {
        if (!ctxRow?.nextStepsScenarioId) {
          return NextResponse.json({ error: "Pick a source scenario first." }, { status: 400 });
        }
        const [owned] = await db
          .select({ id: scenarios.id, name: scenarios.name })
          .from(scenarios)
          .where(and(eq(scenarios.id, ctxRow.nextStepsScenarioId), eq(scenarios.clientId, id)));
        if (!owned) {
          return NextResponse.json(
            { error: "The source scenario no longer exists — pick another." },
            { status: 400 },
          );
        }
        proposedScenario = owned;
        scenarioId = owned.id;
        extras.advisorNotes = ctxRow.nextStepsContext;
      } else {
        extras.advisorNotes = ctxRow?.observationsContext ?? "";
      }
    }

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
      // A uuid FK: only a live scenario the run was generated FROM goes here.
      // The observation draft's optional `scenario` override stays in the
      // payload, as it always has.
      scenarioId: proposedScenario?.id ?? null,
      triggeredBy: userId ?? null,
      triggeredByEmail: email,
      requestPayload: { section: section ?? null, scenarioId },
    });

    after(async () => {
      try {
        await markAnalyzing(runId);
        const { effectiveTree } = await loadEffectiveTree(id, firmId, scenarioId, {});
        const projection = runProjectionWithEvents(effectiveTree);
        // Monte Carlo is best-effort here — a cache/compute failure shouldn't
        // block the draft. Never pass `trials`: the compute cache dedupes on
        // the canonical trial count.
        const mc = await getOrComputeMonteCarlo({ clientId: id, firmId, scenarioId }).catch(() => null);
        if (proposedScenario) {
          // The same assembly and the same describers the Plan Comparison
          // page prints — so the model reads "Dan's 401(k)", never a target id.
          const sc = await loadScenarioChangesContext({
            scenarioId: proposedScenario.id,
            clientId: id,
            clientData: effectiveTree,
            projection,
            getInvestmentCatalog: () => listInvestmentOptionCatalog(id, firmId),
            logContext: "POST /clients/[id]/observations/draft-runs",
          });
          extras.proposedChanges = { scenarioName: proposedScenario.name, units: describeAndGroup(sc) };
        }
        await markRunning(runId);
        const facts = buildObservationsFacts(
          { clientData: effectiveTree, projection, monteCarlo: mc?.payload.summary ?? null },
          extras,
        );
        const draft = await generateObservationsDraft(facts, { section });
        await markDone(runId, null, { suggestions: draft.suggestions });
      } catch (err) {
        // The full error goes to the log; the run stores only what an advisor
        // should read — a parser failure's message is the model's whole reply.
        console.error("[observations/draft-runs] background draft failed", err);
        await markFailed(runId, draftFailureMessage(err));
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
