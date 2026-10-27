// src/lib/fact-finder/finish.ts
/**
 * Finish: closes a fact finder import whose rounds the keep-open saves wrote to
 * the plan — nothing more reaches the plan here. One transaction: the import
 * locked, refused while a document is reading, closed with what the saves
 * wrote as its saved list (each line once) and what they left out that no
 * later round saved, and audited.
 *
 * SERVER-SIDE ONLY.
 */
import "server-only";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { snapshotActorName } from "@/lib/audit/actor-name";
import { SAVE_CLOSED_MESSAGE, SAVE_RACE_MESSAGE, SAVE_READING_MESSAGE } from "./api-types";
import { closeFactFinder, lockFactFinder, type FactFinderScope } from "./persist";
import { filesReading } from "./reading-status";
import type { FactFinderState } from "./types";

type Refused = { ok: false; status: 409; error: string };

const refuse = (error: string): Refused => ({ ok: false, status: 409, error });

/** 409: finished already, a document still reading, or another write (or a discard) landed first. A refusal writes nothing. */
export async function finishFactFinder(
  scope: FactFinderScope,
  actorId: string,
  now: Date = new Date(),
): Promise<{ ok: true; factFinder: FactFinderState } | Refused> {
  // The audit row in the transaction names the actor: the Clerk lookup now, not while it holds the import's lock.
  await snapshotActorName(actorId);
  return db.transaction(async (tx) => {
    const state = await lockFactFinder(tx, scope);
    // Discarded since the gate let the request through: there's nothing to close.
    if (!state) return refuse(SAVE_RACE_MESSAGE);
    if (state.closed) return refuse(SAVE_CLOSED_MESSAGE);
    // A document being read lands its rows after the finish — on a closed import, which refuses them.
    if (filesReading(state, now).length > 0) return refuse(SAVE_READING_MESSAGE);
    // A record saved in two rounds (added, then updated) is one saved line, as the later round left it.
    const latest = new Map((state.applied ?? []).map((a) => [a.lineId, a]));
    const saved = [...latest.values()].map(({ lineId, rowId, target, recordId, label }) => ({ lineId, rowId, target, recordId, label }));
    const closed = await closeFactFinder(tx, scope, state.version, { at: now.toISOString(), by: actorId, saved, leftOut: state.leftOut ?? [] });
    if (!closed) return refuse(SAVE_RACE_MESSAGE);
    await recordAudit({
      action: "import.fact_finder_finished",
      resourceType: "client_import",
      resourceId: scope.importId,
      clientId: scope.clientId,
      firmId: scope.firmId,
      actorId,
      metadata: { saved: saved.length },
      tx,
    });
    return { ok: true, factFinder: closed };
  });
}
