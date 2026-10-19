// src/app/api/clients/[id]/imports/[importId]/fact-finder/route.ts
import type { PatchFactFinderResponse } from "@/lib/fact-finder/api-types";
import { editFactFinder } from "@/lib/fact-finder/edit";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { FactFinderOpError, parseOps, type FFOp } from "@/lib/fact-finder/ops";
import { readFactFinderState } from "@/lib/fact-finder/state";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; importId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "view");
  if (!gate.ok) return gate.response;
  return jsonResponse(200, { factFinder: readFactFinderState(gate.payloadJson) });
}

/**
 * Typed edits. Strict on `baseVersion`: a stale client gets 409 and the fresh
 * fact finder, and re-applies its own pending edits if they don't collide; a
 * chat reply that a typed edit landed under applies nothing (`chat/turn.ts`) —
 * so a typed edit and a chat edit never silently overwrite each other. Links
 * are re-scored after an edit that can change one, and the 200 carries the
 * written state so the screen shows them.
 */
export async function PATCH(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "edit");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as { baseVersion?: unknown; ops?: unknown } | null;
  const baseVersion = body?.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return jsonResponse(400, { error: "baseVersion must be a whole number." });
  }

  let ops: FFOp[];
  try {
    ops = parseOps(body?.ops);
  } catch (err) {
    if (err instanceof FactFinderOpError) return jsonResponse(400, { error: err.message });
    throw err;
  }

  const scope = { importId: gate.importId, clientId: gate.clientId, firmId: gate.firmId };
  const outcome = await editFactFinder(scope, readFactFinderState(gate.payloadJson), baseVersion, ops, { by: "advisor" });
  // A 400 carries no fact finder (JSON drops the undefined key).
  if (!outcome.ok) return jsonResponse(outcome.status, { error: outcome.error, factFinder: outcome.factFinder });
  const { state } = outcome;
  return jsonResponse(200, { version: state.version, factFinder: state } satisfies PatchFactFinderResponse);
}
