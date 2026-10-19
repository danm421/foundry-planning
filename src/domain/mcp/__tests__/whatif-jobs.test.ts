// src/domain/mcp/__tests__/whatif-jobs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  after: vi.fn(),
  getJobKv: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  rows: [] as { id: string; isBaseCase?: boolean; seed?: number | null }[],
}));
vi.mock("next/server", () => ({ after: h.after }));
vi.mock("@/lib/whatif/job-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatif/job-store")>()),
  getJobKv: h.getJobKv,
}));
// A fake database: select().from().where(cond) resolves to h.rows, and the
// where-condition is kept so a test can read what it scoped on.
vi.mock("@/db", () => ({
  db: {
    select: h.select.mockImplementation(() => ({
      from: () => ({
        where: async (cond: SQL) => {
          h.where(cond);
          return h.rows;
        },
      }),
    })),
  },
}));

import { assertScenarioOfClient, firstForeignScenario, startWhatIfJob, storedMonteCarloSeed } from "../whatif-jobs";
import { McpUnavailableError } from "../define-tool";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import type { JobKv, WhatIfJob } from "@/lib/whatif/job-store";
import type { McpPrincipal } from "@/lib/mcp/principal";

const principal: McpPrincipal = {
  userId: "u1",
  orgId: "org_1",
  orgRole: "org:member",
  scopes: [],
  tokenSubject: "u1",
  canWrite: true,
  entitlements: ["ai_import"],
};

function memoryKv(failSetsAfter = Infinity) {
  const store = new Map<string, WhatIfJob>();
  let sets = 0;
  const kv: JobKv = {
    get: async <T,>(k: string) => (store.get(k) ?? null) as T | null,
    set: async (k, v) => {
      sets += 1;
      if (sets > failSetsAfter) throw new Error("redis down");
      store.set(k, structuredClone(v) as WhatIfJob);
      return "OK";
    },
  };
  return { kv, store };
}

beforeEach(() => {
  h.after.mockReset();
  h.getJobKv.mockReset();
  h.select.mockClear();
  h.where.mockReset();
  h.rows = [];
});

describe("startWhatIfJob", () => {
  it("answers inline when the run finishes inside the wait, and keeps the function alive with after()", async () => {
    const { kv, store } = memoryKv();
    h.getJobKv.mockReturnValue(kv);
    const out = await startWhatIfJob({ principal, clientId: "c1", kind: "try", total: 1, work: async () => ({ answer: 42 }) });
    expect(out).toEqual({ status: "done", result: { answer: 42 } });
    expect(h.after).toHaveBeenCalledTimes(1);
    expect([...store.values()][0]).toMatchObject({ status: "done", result: { answer: 42 }, clientId: "c1", userId: "u1" });
  });

  it("hands back a jobId when the run outlasts the wait, and finishes the record later", async () => {
    const { kv, store } = memoryKv();
    h.getJobKv.mockReturnValue(kv);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const out = await startWhatIfJob({
      principal, clientId: "c1", kind: "compare", total: 3, inlineWaitMs: 5,
      work: async (onProgress) => {
        await onProgress(1);
        await gate;
        return { rows: 3 };
      },
    });
    expect(out).toMatchObject({ status: "running" });
    const jobId = (out as { jobId: string }).jobId;
    expect(store.get(`whatif:job:${jobId}`)).toMatchObject({ status: "running", progress: { done: 1, total: 3 } });
    release();
    await h.after.mock.calls[0][0]();
    expect(store.get(`whatif:job:${jobId}`)).toMatchObject({ status: "done", result: { rows: 3 } });
  });

  it("records a validation failure's own message, and hides anything else", async () => {
    const { kv } = memoryKv();
    h.getJobKv.mockReturnValue(kv);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await startWhatIfJob({ principal, clientId: "c1", kind: "try", total: 1, work: async () => { throw new WhatIfValidationError("Change 1: nope"); } }),
    ).toEqual({ status: "failed", error: "Change 1: nope" });
    expect(
      await startWhatIfJob({ principal, clientId: "c1", kind: "try", total: 1, work: async () => { throw new Error("pg 22P02"); } }),
    ).toEqual({ status: "failed", error: "Foundry couldn't finish this run." });
    errorSpy.mockRestore();
  });

  it("fails closed when the job store is not configured", async () => {
    h.getJobKv.mockReturnValue(null);
    await expect(
      startWhatIfJob({ principal, clientId: "c1", kind: "try", total: 1, work: async () => 1 }),
    ).rejects.toBeInstanceOf(McpUnavailableError);
  });

  it("survives Redis failing mid-run: the outcome still returns and nothing rejects unhandled", async () => {
    const { kv } = memoryKv(1); // the create succeeds; every later save throws
    h.getJobKv.mockReturnValue(kv);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await startWhatIfJob({
      principal, clientId: "c1", kind: "compare", total: 2,
      work: async (onProgress) => { await onProgress(1); return { ok: true }; },
    });
    expect(out).toEqual({ status: "done", result: { ok: true } });
    await expect(h.after.mock.calls[0][0]()).resolves.toBeDefined();
    errorSpy.mockRestore();
  });
});

describe("assertScenarioOfClient", () => {
  const OWNED = "22222222-2222-4222-8222-222222222222";
  const refusal = (id: string) => `Scenario ${id} isn't one of this household's scenarios. Use list_scenarios for ids.`;

  it("lets the base case through without a query", async () => {
    await expect(assertScenarioOfClient("c1", "base")).resolves.toBeUndefined();
    expect(h.select).not.toHaveBeenCalled();
  });

  it("refuses an id that isn't a uuid, without a query", async () => {
    const err = await assertScenarioOfClient("c1", "scenario-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatIfValidationError);
    expect((err as Error).message).toBe(refusal("scenario-1"));
    expect(h.select).not.toHaveBeenCalled();
  });

  it("refuses a uuid the client's own scenarios don't include (another household's)", async () => {
    h.rows = [];
    const err = await assertScenarioOfClient("c1", OWNED).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatIfValidationError);
    expect((err as Error).message).toBe(refusal(OWNED));
  });

  it("passes a scenario of this client, looked up by both the scenario id and the client id", async () => {
    h.rows = [{ id: OWNED }];
    await expect(assertScenarioOfClient("c1", OWNED)).resolves.toBeUndefined();
    const { params } = new PgDialect().sqlToQuery(h.where.mock.calls[0][0] as SQL);
    expect(params).toEqual(expect.arrayContaining([OWNED, "c1"]));
  });
});

describe("firstForeignScenario", () => {
  const MINE = "22222222-2222-4222-8222-222222222222";
  const THEIRS = "33333333-3333-4333-8333-333333333333";

  it("asks nothing for an empty list", async () => {
    expect(await firstForeignScenario("c1", [])).toBeNull();
    expect(h.select).not.toHaveBeenCalled();
  });

  it("names an id that isn't a uuid, without a query", async () => {
    expect(await firstForeignScenario("c1", [MINE, "scenario-1"])).toBe("scenario-1");
    expect(h.select).not.toHaveBeenCalled();
  });

  it("checks every id in one query scoped to the client, naming the first that isn't this client's", async () => {
    h.rows = [{ id: MINE }];
    expect(await firstForeignScenario("c1", [MINE, THEIRS])).toBe(THEIRS);
    expect(h.select).toHaveBeenCalledTimes(1);
    const { params } = new PgDialect().sqlToQuery(h.where.mock.calls[0][0] as SQL);
    expect(params).toEqual(expect.arrayContaining(["c1", MINE, THEIRS]));

    h.rows = [{ id: MINE }, { id: THEIRS }];
    expect(await firstForeignScenario("c1", [MINE, THEIRS])).toBeNull();
  });
});

// The seed loadMonteCarloData reads for a source: the scenario's own row, the
// base case's for "base" (or for a scenario it can't find). Never a fresh one.
describe("storedMonteCarloSeed", () => {
  const BASE = "11111111-1111-4111-8111-111111111111";
  const SAVED = "22222222-2222-4222-8222-222222222222";

  it("reads the base case's seed for the base case, from one query scoped to the client", async () => {
    h.rows = [{ id: BASE, isBaseCase: true, seed: 42 }];
    expect(await storedMonteCarloSeed("c1", "base")).toBe(42);
    expect(h.select).toHaveBeenCalledTimes(1);
    const { params } = new PgDialect().sqlToQuery(h.where.mock.calls[0][0] as SQL);
    expect(params).toContain("c1");
  });

  it("reads a saved scenario's own seed, not the base case's", async () => {
    h.rows = [
      { id: BASE, isBaseCase: true, seed: 42 },
      { id: SAVED, isBaseCase: false, seed: 7 },
    ];
    expect(await storedMonteCarloSeed("c1", SAVED)).toBe(7);
    const { params } = new PgDialect().sqlToQuery(h.where.mock.calls[0][0] as SQL);
    expect(params).toEqual(expect.arrayContaining(["c1", SAVED]));
  });

  it("answers nothing when the source has no seed stored yet — never the base case's in its place", async () => {
    h.rows = [
      { id: BASE, isBaseCase: true, seed: 42 },
      { id: SAVED, isBaseCase: false, seed: null },
    ];
    expect(await storedMonteCarloSeed("c1", SAVED)).toBeUndefined();
    h.rows = [{ id: BASE, isBaseCase: true, seed: null }];
    expect(await storedMonteCarloSeed("c1", "base")).toBeUndefined();
  });

  it("falls back to the base case for a scenario it can't find, as loadMonteCarloData does", async () => {
    h.rows = [{ id: BASE, isBaseCase: true, seed: 42 }];
    expect(await storedMonteCarloSeed("c1", SAVED)).toBe(42);
  });
});
