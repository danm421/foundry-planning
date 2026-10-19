// src/lib/fact-finder/edit.ts
/**
 * Typed edits on a fact finder, for the PATCH route and the Claude connector.
 * Session-free: the caller has run the gate and hands over the state it read.
 */
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import { FactFinderOpError, applyOps, countOps, type FFOp, type OpContext } from "./ops";
import { loadFactFinder, writeFactFinder, type FactFinderScope } from "./persist";
import { opsNeedRelink, relinkBaseCase } from "./relink";
import { stampSources, type SourceStamp } from "./sources";
import type { FactFinderState } from "./types";

export type EditOutcome =
  | { ok: true; state: FactFinderState }
  | { ok: false; status: 400 | 409; error: string; factFinder?: FactFinderState };

/**
 * Strict on `baseVersion`: a stale caller gets 409 and the fact finder as it is,
 * and nothing is written. `stamps` cite the document each value came from.
 * Links are re-scored after an edit that can change one. Without `actorId`,
 * the audit row names the session's actor.
 */
export async function editFactFinder(
  scope: FactFinderScope,
  current: FactFinderState,
  baseVersion: number,
  ops: FFOp[],
  ctx: { by: OpContext["by"]; actorId?: string; stamps?: readonly SourceStamp[] },
): Promise<EditOutcome> {
  if (current.version !== baseVersion) return { ok: false, status: 409, error: "conflict", factFinder: current };
  let next: FactFinderState;
  try {
    next = applyOps(current, ops, { by: ctx.by, now: new Date().toISOString(), newId: randomUUID });
  } catch (err) {
    if (err instanceof FactFinderOpError) return { ok: false, status: 400, error: err.message };
    throw err;
  }
  if (ctx.stamps) next = stampSources(next, ctx.stamps);
  if (opsNeedRelink(ops)) next = await relinkBaseCase(next, scope.clientId);

  const written = await writeFactFinder(scope, baseVersion, next);
  if (!written) return { ok: false, status: 409, error: "conflict", factFinder: (await loadFactFinder(scope)) ?? current };

  await recordAudit({
    action: "import.payload.edited",
    resourceType: "client_import",
    resourceId: scope.importId,
    clientId: scope.clientId,
    firmId: scope.firmId,
    actorId: ctx.actorId,
    metadata: { surface: "fact_finder", ops: countOps(ops), version: written.version },
  });
  return { ok: true, state: written };
}
