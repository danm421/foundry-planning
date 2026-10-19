// src/app/api/clients/[id]/imports/[importId]/fact-finder/save/route.ts
import { auth } from "@clerk/nextjs/server";
import { SAVE_FAILED_MESSAGE, type SaveBody, type SaveRefusal, type SaveResponse } from "@/lib/fact-finder/api-types";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { saveChangeSet, type SaveOutcome } from "@/lib/fact-finder/save/save";
import { safeErrorFields } from "@/lib/redaction/secrets";

export const dynamic = "force-dynamic";
// The whole save is one transaction: every line's write path, then the queued holdings sync.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

/**
 * Writes the ticked lines of the reviewed change list to the plan in one
 * transaction and closes the import (D11). Only the version and the ticks
 * come from the browser — the change list, its record ids and its values are
 * read from the stored fact finder. The save owns every refusal's wording.
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "commit");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId, userId } = gate;

  const body = (await request.json().catch(() => null)) as Partial<Record<keyof SaveBody, unknown>> | null;
  const { changeSetVersion, ticks } = body ?? {};
  if (
    typeof changeSetVersion !== "number" ||
    !Number.isInteger(changeSetVersion) ||
    changeSetVersion < 0 ||
    typeof ticks !== "object" ||
    ticks === null ||
    Array.isArray(ticks)
  ) {
    return jsonResponse(400, { error: "Send the change list's version and ticks." });
  }

  // Attributed as recordAudit attributes a session it reads itself: while an ops operator impersonates
  // the advisor, the session's user is the advisor and the operator is `actor.sub`.
  const { actor } = await auth();
  const operator = typeof actor?.sub === "string" ? actor.sub : null;
  const actorArgs = operator ? { actorId: operator, actingAsAdvisor: userId } : { actorId: userId };

  let outcome: SaveOutcome;
  try {
    outcome = await saveChangeSet({ scope: { importId, clientId, firmId }, ...actorArgs, changeSetVersion, ticks });
  } catch (err) {
    // A read before the save's transaction failed (the save answers everything after it): nothing was written.
    console.error(`[fact-finder-save] import ${importId}: the save failed before writing:`, safeErrorFields(err));
    return jsonResponse(500, { error: SAVE_FAILED_MESSAGE } satisfies SaveRefusal);
  }
  if (outcome.ok) return jsonResponse(200, { factFinder: outcome.factFinder } satisfies SaveResponse);
  const { status, error, lineId, factFinder } = outcome;
  return jsonResponse(status, {
    error,
    ...(lineId !== undefined && { lineId }),
    ...(factFinder !== undefined && { factFinder }),
  } satisfies SaveRefusal);
}
