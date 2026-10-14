// src/domain/mcp/whatif-jobs.ts
//
// The IO half of the what-if tools: loading the starting tree, charging the
// compute limit, and running heavy work as a background job that outlives the
// tool call (src/lib/whatif/job-store.ts). The pure half is src/lib/whatif/.
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { getOrComputeSolverMc } from "@/lib/compute-cache/solver-mc";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { checkMcpComputeRateLimit } from "@/lib/rate-limit";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { INLINE_WAIT_MS } from "@/lib/whatif/caps";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import { getJobKv, newJob, saveJob, type WhatIfJob } from "@/lib/whatif/job-store";
import type { RunDeps } from "@/lib/whatif/run";
import { McpRateLimitedError, McpUnavailableError } from "./define-tool";

/** A model-supplied scenario id must be one of THIS client's scenarios. */
export async function assertScenarioOfClient(clientId: string, scenarioId: string): Promise<void> {
  if (scenarioId === "base") return;
  const refuse = () =>
    new WhatIfValidationError(`Scenario ${scenarioId} isn't one of this household's scenarios. Use list_scenarios for ids.`);
  if (!z.string().uuid().safeParse(scenarioId).success) throw refuse();
  const [row] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)))
    .limit(1);
  if (!row) throw refuse();
}

export async function buildRunDeps(clientId: string, firmId: string, scenario: string): Promise<RunDeps> {
  await assertScenarioOfClient(clientId, scenario);
  const { effectiveTree, resolutionContext } = await loadEffectiveTree(clientId, firmId, scenario, {});
  return {
    tree: effectiveTree,
    resolutionContext,
    loadMcPayload: (working) => loadMonteCarloData(clientId, firmId, scenario, [], working),
    monteCarloSuccess: async (mutations) =>
      (await getOrComputeSolverMc({ clientId, firmId, source: scenario, mutations })).successRate,
    now: () => Date.now(),
  };
}

export async function chargeCompute(principal: McpPrincipal, weight: number): Promise<void> {
  const rl = await checkMcpComputeRateLimit(`${principal.orgId}:${principal.userId}`, weight);
  if (!rl.allowed) throw new McpRateLimitedError(rl.reason);
}

export type JobOutcome =
  | { status: "done"; result: unknown }
  | { status: "failed"; error: string }
  | { status: "running"; jobId: string; progress: { done: number; total: number } };

/**
 * Run `work` as a job: record it, start it, keep the function alive with
 * after(), and wait up to INLINE_WAIT_MS. The work promise never rejects —
 * every failure lands in the job record — so a Redis outage mid-run is logged
 * and can never become an unhandled rejection.
 */
export async function startWhatIfJob(args: {
  principal: McpPrincipal;
  clientId: string;
  kind: WhatIfJob["kind"];
  total: number;
  work: (onProgress: (done: number) => Promise<void>) => Promise<unknown>;
  inlineWaitMs?: number;
}): Promise<JobOutcome> {
  const kv = getJobKv();
  if (!kv) throw new McpUnavailableError();
  const job = newJob({
    firmId: args.principal.orgId,
    userId: args.principal.userId,
    clientId: args.clientId,
    kind: args.kind,
    total: args.total,
  });
  try {
    await saveJob(kv, job);
  } catch (err) {
    console.error("[whatif-jobs] could not create job:", err);
    throw new McpUnavailableError();
  }

  const settle = async (patch: Partial<WhatIfJob>) => {
    Object.assign(job, patch);
    try {
      await saveJob(kv, job);
    } catch (err) {
      console.error("[whatif-jobs] could not save job", job.id, err);
    }
  };

  const finished: Promise<JobOutcome> = (async () => {
    try {
      const result = await args.work((done) => settle({ progress: { done, total: args.total } }));
      await settle({ status: "done", result });
      return { status: "done", result } as const;
    } catch (err) {
      console.error("[whatif-jobs] run failed", job.id, err);
      const error = err instanceof WhatIfValidationError ? err.message : "Foundry couldn't finish this run.";
      await settle({ status: "failed", error });
      return { status: "failed", error } as const;
    }
  })();
  after(() => finished);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), args.inlineWaitMs ?? INLINE_WAIT_MS);
  });
  const first = await Promise.race([finished, timeout]);
  clearTimeout(timer);
  return first ?? { status: "running", jobId: job.id, progress: { ...job.progress } };
}
