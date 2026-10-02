import type { LtcEvent } from "@/engine/types";

/** Saves the whole event into the scenario as its own change. The changes
 *  route upserts a whole-event add (an `edit` is refused by design), so the
 *  Stress row's first save and the dialog's re-save are the same call.
 *  Throws when the server refuses. */
export async function saveLtcEvent(clientId: string, scenarioId: string, event: LtcEvent): Promise<void> {
  const res = await fetch(`/api/clients/${clientId}/scenarios/${scenarioId}/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "add", targetKind: "ltc_event", entity: event }),
  });
  if (!res.ok) throw new Error(String(res.status));
}
