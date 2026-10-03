import type { StressTest } from "@/engine/types";

const changesUrl = (clientId: string, scenarioId: string) =>
  `/api/clients/${clientId}/scenarios/${scenarioId}/changes`;

async function ok(res: Response): Promise<void> {
  if (!res.ok) throw new Error(String(res.status));
}

/** Saves the whole stressor. The route upserts on the fixed per-kind id, so a
 *  first save and a re-save are the same call. Throws when the server refuses. */
export async function saveStressTest(clientId: string, scenarioId: string, test: StressTest): Promise<void> {
  await ok(
    await fetch(changesUrl(clientId, scenarioId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "add", targetKind: "stress_test", entity: test }),
    }),
  );
}

/** The saved change's on/off switch — the same flag the Changes tab flips. */
export async function setStressTestEnabled(
  clientId: string,
  scenarioId: string,
  changeId: string,
  enabled: boolean,
): Promise<void> {
  await ok(
    await fetch(`${changesUrl(clientId, scenarioId)}/${changeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  );
}

export async function removeStressTest(clientId: string, scenarioId: string, testId: string): Promise<void> {
  await ok(
    await fetch(`${changesUrl(clientId, scenarioId)}?kind=stress_test&target=${testId}&op=add`, {
      method: "DELETE",
    }),
  );
}
