import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getJobKv,
  jobKey,
  newJob,
  readJobFor,
  saveJob,
  waitForJob,
  __resetJobKvForTests,
  JOB_TTL_SECONDS,
  STALE_JOB_MS,
  type JobKv,
  type WhatIfJob,
} from "../job-store";

function memoryKv() {
  const store = new Map<string, unknown>();
  const ttl = new Map<string, number>();
  const kv: JobKv = {
    get: async <T,>(k: string) => (store.has(k) ? (structuredClone(store.get(k)) as T) : null),
    set: async (k, v, o) => {
      store.set(k, structuredClone(v));
      ttl.set(k, o.ex);
      return "OK";
    },
  };
  return { kv, store, ttl };
}

const OWNER = { firmId: "org_1", userId: "user_1" };

describe("job store", () => {
  it("saves a job under its key for 24 hours", async () => {
    const { kv, store, ttl } = memoryKv();
    const job = newJob({ ...OWNER, clientId: "c1", kind: "compare", total: 8, now: 1_000 });
    await saveJob(kv, job);
    expect(store.get(jobKey(job.id))).toEqual(job);
    expect(ttl.get(jobKey(job.id))).toBe(JOB_TTL_SECONDS);
    expect(job).toMatchObject({ status: "running", progress: { done: 0, total: 8 }, startedAt: 1_000 });
  });

  it("returns the job to the advisor who started it", async () => {
    const { kv } = memoryKv();
    const job = newJob({ ...OWNER, clientId: "c1", kind: "try", total: 1, now: 0 });
    await saveJob(kv, job);
    expect(await readJobFor(kv, job.id, OWNER, 10)).toEqual(job);
  });

  it("answers another advisor, another firm and a missing id the same way", async () => {
    const { kv } = memoryKv();
    const job = newJob({ ...OWNER, clientId: "c1", kind: "try", total: 1, now: 0 });
    await saveJob(kv, job);
    expect(await readJobFor(kv, job.id, { firmId: "org_1", userId: "user_2" }, 10)).toBeNull();
    expect(await readJobFor(kv, job.id, { firmId: "org_2", userId: "user_1" }, 10)).toBeNull();
    expect(await readJobFor(kv, "no-such-job", OWNER, 10)).toBeNull();
  });

  it("reports a job still running past 15 minutes as interrupted", async () => {
    const { kv } = memoryKv();
    const job = newJob({ ...OWNER, clientId: "c1", kind: "try", total: 1, now: 0 });
    await saveJob(kv, job);
    const read = await readJobFor(kv, job.id, OWNER, STALE_JOB_MS + 1);
    expect(read).toMatchObject({ status: "failed", error: "The run was interrupted. Start it again." });
  });
});

describe("waitForJob", () => {
  const running: WhatIfJob = {
    id: "j", firmId: "f", userId: "u", clientId: "c", kind: "try", status: "running",
    progress: { done: 0, total: 1 }, startedAt: 0,
  };

  it("returns at once when the job is already finished", async () => {
    const read = vi.fn(async () => ({ ...running, status: "done" as const }));
    const sleep = vi.fn(async () => {});
    expect((await waitForJob(read, { timeoutMs: 50_000, intervalMs: 2_000, sleep }))?.status).toBe("done");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("polls until the job finishes", async () => {
    let t = 0;
    const read = vi
      .fn<() => Promise<WhatIfJob | null>>()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce({ ...running, status: "done" });
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const out = await waitForJob(read, { timeoutMs: 50_000, intervalMs: 2_000, now: () => t, sleep });
    expect(out?.status).toBe("done");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("gives up at the timeout and returns the job still running", async () => {
    let t = 0;
    const read = vi.fn(async () => running);
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const out = await waitForJob(read, { timeoutMs: 10_000, intervalMs: 2_000, now: () => t, sleep });
    expect(out?.status).toBe("running");
    expect(t).toBeLessThanOrEqual(10_000);
  });
});

describe("getJobKv", () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __resetJobKvForTests();
  });

  it("returns null when Upstash is not configured, so callers fail closed", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getJobKv()).toBeNull();
    errorSpy.mockRestore();
  });
});
