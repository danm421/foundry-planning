// src/app/api/clients/[id]/imports/[importId]/fact-finder/save/route.ts
import type { SaveBody, SaveRefusal, SaveResponse } from "@/lib/fact-finder/api-types";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { saveChangeSet } from "@/lib/fact-finder/save/save";

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

  const outcome = await saveChangeSet({ scope: { importId, clientId, firmId }, actorId: userId, changeSetVersion, ticks });
  if (outcome.ok) return jsonResponse(200, { factFinder: outcome.factFinder } satisfies SaveResponse);
  const { status, error, lineId, factFinder } = outcome;
  return jsonResponse(status, {
    error,
    ...(lineId !== undefined && { lineId }),
    ...(factFinder !== undefined && { factFinder }),
  } satisfies SaveRefusal);
}
