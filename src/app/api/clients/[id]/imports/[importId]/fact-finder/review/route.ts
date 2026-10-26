// src/app/api/clients/[id]/imports/[importId]/fact-finder/review/route.ts
import type { ReviewBody, ReviewResponse } from "@/lib/fact-finder/api-types";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { runLeftovers } from "@/lib/fact-finder/placement/leftovers-run";
import { reviewFactFinder } from "@/lib/fact-finder/review";
import { readFactFinderState } from "@/lib/fact-finder/state";

export const dynamic = "force-dynamic";
// The record book, then one AI call that can take up to 90 s.
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; importId: string }> };

/**
 * Pass 2 (D12): builds the change list and stores it on the fact finder
 * (`reviewFactFinder`) — nothing is written to the plan. A body `rowIds` scopes
 * it to those rows. A refusal is a 409.
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "match");
  if (!gate.ok) return gate.response;
  // The body is optional: none, or none with `rowIds`, reviews every row.
  const body = (await request.json().catch(() => null)) as Partial<Record<keyof ReviewBody, unknown>> | null;
  const rowIds = body?.rowIds;
  if (rowIds !== undefined && !(Array.isArray(rowIds) && rowIds.every((id) => typeof id === "string"))) {
    return jsonResponse(400, { error: "rowIds must be a list of row ids." });
  }
  const { firmId, clientId, importId } = gate;
  const outcome = await reviewFactFinder({ importId, clientId, firmId }, readFactFinderState(gate.payloadJson), {
    now: new Date(),
    runLeftovers,
    onlyRows: rowIds,
  });
  if (!outcome.ok) return jsonResponse(outcome.status, outcome.body);
  return jsonResponse(200, { factFinder: outcome.factFinder } satisfies ReviewResponse);
}
