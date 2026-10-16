// src/lib/whatif/job-store.ts
//
// What-if jobs: a heavy run's state, kept in Upstash Redis for 24 hours. No
// database table — what-ifs are never saved, so their results are disposable
// by design. Fails CLOSED: with Redis unconfigured, getJobKv() returns null
// and every caller refuses the call (unlike ai-cache.ts, which fails open —
// a cache can be skipped, a job store cannot).
import { Redis } from "@upstash/redis";
import { JOB_TTL_SECONDS, STALE_JOB_MS } from "./caps";

export { JOB_TTL_SECONDS, STALE_JOB_MS };

export interface WhatIfJob {
  id: string;
  firmId: string;
  userId: string;
  clientId: string;
  kind: "try" | "compare";
  status: "running" | "done" | "failed";
  progress: { done: number; total: number };
  result?: unknown;
  error?: string;
  startedAt: number;
}

export interface JobKv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts: { ex: number }): Promise<unknown>;
}

export const jobKey = (id: string) => `whatif:job:${id}`;

let client: JobKv | null = null;
let resolved = false;

export function getJobKv(): JobKv | null {
  if (resolved) return client;
  resolved = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.error("[whatif-jobs] UPSTASH_REDIS_REST_URL / _TOKEN unset — what-if jobs fail closed.");
    client = null;
    return null;
  }
  const redis = new Redis({ url, token });
  client = {
    get: <T>(key: string) => redis.get<T>(key),
    set: (key, value, opts) => redis.set(key, value, { ex: opts.ex }),
  };
  return client;
}

export function __resetJobKvForTests(): void {
  client = null;
  resolved = false;
}

export function newJob(input: {
  firmId: string;
  userId: string;
  clientId: string;
  kind: WhatIfJob["kind"];
  total: number;
  now?: number;
}): WhatIfJob {
  return {
    id: crypto.randomUUID(),
    firmId: input.firmId,
    userId: input.userId,
    clientId: input.clientId,
    kind: input.kind,
    status: "running",
    progress: { done: 0, total: input.total },
    startedAt: input.now ?? Date.now(),
  };
}

export async function saveJob(kv: JobKv, job: WhatIfJob): Promise<void> {
  await kv.set(jobKey(job.id), job, { ex: JOB_TTL_SECONDS });
}

/** The job, only for the advisor who started it. Everyone else gets null — the
 *  same answer as a missing or expired job, so existence never leaks. */
export async function readJobFor(
  kv: JobKv,
  id: string,
  who: { firmId: string; userId: string },
  now: number = Date.now(),
): Promise<WhatIfJob | null> {
  const job = await kv.get<WhatIfJob>(jobKey(id));
  if (!job || job.firmId !== who.firmId || job.userId !== who.userId) return null;
  if (job.status === "running" && now - job.startedAt > STALE_JOB_MS) {
    return { ...job, status: "failed", error: "The run was interrupted. Start it again." };
  }
  return job;
}

/** Re-read until the job leaves "running" or the timeout would be passed. */
export async function waitForJob(
  read: () => Promise<WhatIfJob | null>,
  opts: {
    timeoutMs: number;
    intervalMs: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<WhatIfJob | null> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + opts.timeoutMs;
  let job = await read();
  while (job && job.status === "running" && now() + opts.intervalMs <= deadline) {
    await sleep(opts.intervalMs);
    job = await read();
  }
  return job;
}
