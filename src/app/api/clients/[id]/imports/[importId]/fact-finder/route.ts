// src/app/api/clients/[id]/imports/[importId]/fact-finder/route.ts
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { FactFinderOpError, applyOps, parseOps, type FFOp } from "@/lib/fact-finder/ops";
import { loadFactFinder, writeFactFinder } from "@/lib/fact-finder/persist";
import { readFactFinderState } from "@/lib/fact-finder/state";
import type { FactFinderState } from "@/lib/fact-finder/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; importId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "view");
  if (!gate.ok) return gate.response;
  return jsonResponse(200, { factFinder: readFactFinderState(gate.payloadJson) });
}

function countOps(ops: readonly FFOp[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of ops) counts[op.op] = (counts[op.op] ?? 0) + 1;
  return counts;
}

/**
 * Typed edits. Strict on `baseVersion`: a stale client gets 409 and the fresh
 * fact finder, and re-applies its own pending edits if they don't collide —
 * so a typed edit and a chat edit never silently overwrite each other.
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
  let next: FactFinderState;
  const current = readFactFinderState(gate.payloadJson);
  try {
    ops = parseOps(body?.ops);
    if (current.version !== baseVersion) return jsonResponse(409, { error: "conflict", factFinder: current });
    next = applyOps(current, ops, { by: "advisor", now: new Date().toISOString(), newId: randomUUID });
  } catch (err) {
    if (err instanceof FactFinderOpError) return jsonResponse(400, { error: err.message });
    throw err;
  }

  const scope = { importId: gate.importId, clientId: gate.clientId, firmId: gate.firmId };
  const written = await writeFactFinder(scope, baseVersion, next);
  if (!written) {
    const fresh = await loadFactFinder(scope);
    return jsonResponse(409, { error: "conflict", factFinder: fresh ?? current });
  }

  await recordAudit({
    action: "import.payload.edited",
    resourceType: "client_import",
    resourceId: gate.importId,
    clientId: gate.clientId,
    firmId: gate.firmId,
    metadata: { surface: "fact_finder", ops: countOps(ops), version: written.version },
  });
  return jsonResponse(200, { version: written.version });
}
