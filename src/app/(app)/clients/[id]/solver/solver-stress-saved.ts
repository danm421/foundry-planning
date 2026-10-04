import type { StressTest } from "@/engine/types";
import type { ToggleGroup } from "@/engine/scenario/types";
import { resolveEffectiveToggleState } from "@/engine/scenario/applyChanges";

const changesUrl = (clientId: string, scenarioId: string) =>
  `/api/clients/${clientId}/scenarios/${scenarioId}/changes`;

/** Sends one change request. Throws when the server refuses. */
async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(String(res.status));
}

/** Saves the whole stressor. The route upserts on the fixed per-kind id, so a
 *  first save and a re-save are the same call. */
export function saveStressTest(clientId: string, scenarioId: string, test: StressTest): Promise<void> {
  return send(changesUrl(clientId, scenarioId), "POST", { op: "add", targetKind: "stress_test", entity: test });
}

/** The saved change's on/off switch — the same flag the Changes tab flips. */
export function setStressTestEnabled(
  clientId: string,
  scenarioId: string,
  changeId: string,
  enabled: boolean,
): Promise<void> {
  return send(`${changesUrl(clientId, scenarioId)}/${changeId}`, "PATCH", { enabled });
}

export function removeStressTest(clientId: string, scenarioId: string, testId: string): Promise<void> {
  return send(`${changesUrl(clientId, scenarioId)}?kind=stress_test&target=${testId}&op=add`, "DELETE");
}

/** Name of every group the Solver's tree runs without — switched off itself, or
 *  under a switched-off parent — by id. The Solver loads the scenario with each
 *  group at its saved state, so a saved stressor in one of these is not applied
 *  however its own switch reads. */
export function switchedOffGroupNames(groups: ToggleGroup[]): Record<string, string> {
  const effective = resolveEffectiveToggleState({}, groups);
  return Object.fromEntries(groups.filter((g) => !effective[g.id]).map((g) => [g.id, g.name]));
}
