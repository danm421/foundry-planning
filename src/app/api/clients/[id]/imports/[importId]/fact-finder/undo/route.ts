// src/app/api/clients/[id]/imports/[importId]/fact-finder/undo/route.ts
import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/audit";
import type { UndoResponse } from "@/lib/fact-finder/api-types";
import { factFinderGate, jsonResponse } from "@/lib/fact-finder/gate";
import { applyLinkScores } from "@/lib/fact-finder/matching/score";
import { FactFinderOpError, applyOps } from "@/lib/fact-finder/ops";
import { FactFinderBusyError, FactFinderNotFoundError, updateFactFinder } from "@/lib/fact-finder/persist";
import { loadBaseCaseRecords } from "@/lib/fact-finder/relink";
import type { FactFinderState } from "@/lib/fact-finder/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; importId: string }> };

/**
 * Undo one chat reply: put its rows back as they were before it. Refused (409,
 * the message as-is) once any of those rows has changed since, or once the
 * reply's Undo has been dropped.
 */
export async function POST(request: Request, { params }: Params) {
  const gate = await factFinderGate(params, "turn");
  if (!gate.ok) return gate.response;
  const { firmId, clientId, importId } = gate;

  const body = (await request.json().catch(() => null)) as { turnId?: unknown } | null;
  const turnId = body?.turnId;
  if (typeof turnId !== "string" || turnId === "") return jsonResponse(400, { error: "Say which reply to undo." });

  const records = await loadBaseCaseRecords(clientId);
  let rows = 0;
  let written: FactFinderState;
  try {
    written = await updateFactFinder({ importId, clientId, firmId }, (fresh) => {
      if (!Object.hasOwn(fresh.undo, turnId)) throw new FactFinderOpError("That reply can't be undone any more.");
      const snapshots = fresh.undo[turnId];
      const now = new Date().toISOString();
      const restored = applyOps(fresh, [{ op: "restoreSnapshots", snapshots }], { by: "advisor", now, newId: randomUUID });
      const undo = { ...restored.undo };
      delete undo[turnId];
      rows = snapshots.filter((s) => s.kind === "row").length;
      const next = applyLinkScores({ ...restored, undo }, records);
      return { ...next, transcript: [...next.transcript, { id: randomUUID(), role: "tool", tool: "undo", summary: "Undid that reply", at: now }] };
    });
  } catch (err) {
    if (err instanceof FactFinderOpError) return jsonResponse(409, { error: err.message });
    if (err instanceof FactFinderNotFoundError) return jsonResponse(404, { error: err.message });
    if (err instanceof FactFinderBusyError) return jsonResponse(409, { error: err.message });
    throw err;
  }

  await recordAudit({
    action: "import.chat.undo",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    metadata: { surface: "fact_finder", rows },
  });
  return jsonResponse(200, { factFinder: written } satisfies UndoResponse);
}
