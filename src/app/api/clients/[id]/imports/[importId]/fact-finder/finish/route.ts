// src/app/api/clients/[id]/imports/[importId]/fact-finder/finish/route.ts
import { auth } from "@clerk/nextjs/server";
import type { ErrorResponse, FinishResponse } from "@/lib/fact-finder/api-types";
import { finishFactFinder } from "@/lib/fact-finder/finish";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; importId: string }> };

/**
 * Finish import: closes the fact finder once the chat's rounds are saved to
 * the plan. Nothing is written to the plan here; the closed import's saved
 * list is what those saves wrote. The finish owns every refusal's wording.
 */
export async function POST(_request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "commit");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId, userId } = gate;

  // Attributed as the save route attributes it: while an ops operator impersonates the advisor, the operator is `actor.sub`.
  const { actor } = await auth();
  const actorId = typeof actor?.sub === "string" ? actor.sub : userId;

  const outcome = await finishFactFinder({ importId, clientId, firmId }, actorId);
  if (outcome.ok) return jsonResponse(200, { factFinder: outcome.factFinder } satisfies FinishResponse);
  return jsonResponse(outcome.status, { error: outcome.error } satisfies ErrorResponse);
}
