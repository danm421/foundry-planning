// src/domain/mcp/__tests__/whatif-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  buildRunDeps: vi.fn(),
  chargeCompute: vi.fn(),
  startWhatIfJob: vi.fn(),
  verifyClientAccessFor: vi.fn(),
  getJobKv: vi.fn(),
  prepareVariants: vi.fn(),
}));

vi.mock("../whatif-jobs", () => ({
  buildRunDeps: h.buildRunDeps,
  chargeCompute: h.chargeCompute,
  startWhatIfJob: h.startWhatIfJob,
}));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccessFor: h.verifyClientAccessFor }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({
  checkMcpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 1, reset: 0 }),
}));
vi.mock("@/lib/whatif/job-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatif/job-store")>()),
  getJobKv: h.getJobKv,
}));
vi.mock("@/lib/whatif/caps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatif/caps")>()),
  POLL_WAIT_MS: 0,
  POLL_INTERVAL_MS: 0,
}));
// The real prepareVariants, watched, so a test can read the options it got.
vi.mock("@/lib/whatif/run", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/whatif/run")>();
  h.prepareVariants.mockImplementation(real.prepareVariants);
  return { ...real, prepareVariants: h.prepareVariants };
});

import { whatifTools, JOB_NOT_FOUND_MESSAGE, tryResult, compareResult } from "../tools/whatif";
import { McpUnavailableError } from "../define-tool";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import { newJob, saveJob, type JobKv, type WhatIfJob } from "@/lib/whatif/job-store";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import type { RunOutput, VariantResult } from "@/lib/whatif/run";
import type { WhatIfMetrics } from "@/lib/whatif/metrics";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { IDS, whatIfTree } from "@/lib/whatif/__tests__/fixtures";

const principal: McpPrincipal = { userId: "u1", orgId: "org_1", orgRole: "org:member", scopes: [], tokenSubject: "u1" };
const byName = (n: string) => whatifTools.find((t) => t.name === n)!;

function memoryKv(): JobKv {
  const store = new Map<string, unknown>();
  return {
    get: async <T,>(k: string) => (store.get(k) ?? null) as T | null,
    set: async (k, v) => { store.set(k, structuredClone(v)); return "OK"; },
  };
}

beforeEach(() => {
  h.buildRunDeps.mockReset().mockImplementation(async () => ({
    tree: whatIfTree(),
    loadMcPayload: async () => ({}) as MonteCarloPayload,
    monteCarloSuccess: async () => 0.8,
    now: () => 0,
  }));
  h.chargeCompute.mockReset().mockResolvedValue(undefined);
  h.startWhatIfJob.mockReset().mockImplementation(async ({ work }) => ({ status: "done", result: await work(async () => {}) }));
  h.verifyClientAccessFor.mockReset().mockResolvedValue({ ok: true, permission: "view", firmId: "org_1", access: "own" });
  h.getJobKv.mockReset();
  h.prepareVariants.mockClear();
});

/** A run that never finishes inside the call: the work is not started. */
const leaveRunning = () =>
  h.startWhatIfJob.mockImplementation(async () => ({ status: "running", jobId: "j1", progress: { done: 0, total: 1 } }));

/** A max-spending solve that answers at once, so a success-based solve can run without a real Monte Carlo. */
const stubMaxSpending = { maxSpending: async () => ({ realAnnualSpend: 95_000, scaleFactor: 1.2, achievedPoS: 0.86, status: "converged" as const }) };

describe("try_what_if", () => {
  it("answers a deterministic what-if inline, without a job", async () => {
    const out = (await byName("try_what_if").run(
      { clientId: "c1", changes: [{ type: "retirement_age", person: "client", age: 62 }] },
      principal,
    )) as { status: string; result: { current: unknown; whatIf: { endingPortfolio: number }; deltas: object } };
    expect(out.status).toBe("done");
    expect(out.result.whatIf.endingPortfolio).toEqual(expect.any(Number));
    expect(out.result.deltas).toHaveProperty("endingPortfolio");
    expect(h.startWhatIfJob).not.toHaveBeenCalled();
    expect(h.chargeCompute).toHaveBeenCalledWith(principal, 2);
  });

  it("sends a solve through a job", async () => {
    await byName("try_what_if").run(
      { clientId: "c1", changes: [], solveFor: { kind: "ss_claim_age", person: "client" }, includeMonteCarlo: true },
      principal,
    );
    expect(h.startWhatIfJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "try", total: 1, clientId: "c1" }));
  });

  it("refuses a foreign id before charging or starting anything", async () => {
    await expect(
      byName("try_what_if").run(
        { clientId: "c1", changes: [{ type: "expense_amount", expenseId: IDS.foreign, annualAmount: 1 }] },
        principal,
      ),
    ).rejects.toBeInstanceOf(WhatIfValidationError);
    expect(h.chargeCompute).not.toHaveBeenCalled();
    expect(h.startWhatIfJob).not.toHaveBeenCalled();
  });

  it("runs Monte Carlo for a success-based solve even when includeMonteCarlo is left out", async () => {
    const monteCarloSuccess = vi.fn(async () => 0.8);
    h.buildRunDeps.mockImplementation(async () => ({
      tree: whatIfTree(),
      loadMcPayload: async () => ({}) as MonteCarloPayload,
      monteCarloSuccess,
      now: () => 0,
      solvers: stubMaxSpending,
    }));
    const out = (await byName("try_what_if").run(
      { clientId: "c1", changes: [], solveFor: { kind: "max_spending", targetSuccess: 0.85 } },
      principal,
    )) as { result: { current: WhatIfMetrics; whatIf: WhatIfMetrics; solve: { value: number } } };
    expect(h.startWhatIfJob).toHaveBeenCalled();
    expect(monteCarloSuccess).toHaveBeenCalledTimes(2); // today's plan and the what-if
    expect(out.result.current.successRate).toBe(0.8);
    expect(out.result.whatIf.successRate).toBe(0.8);
    expect(out.result.solve.value).toBe(95_000);
  });

  it("leaves Monte Carlo off for a claim-age solve, which needs none", async () => {
    const out = (await byName("try_what_if").run(
      { clientId: "c1", changes: [], solveFor: { kind: "ss_claim_age", person: "client" } },
      principal,
    )) as { status: string; result: { whatIf: WhatIfMetrics } };
    expect(h.startWhatIfJob).not.toHaveBeenCalled();
    expect(out.result.whatIf.successRate).toBeNull();
  });

  it("translates new records with the household's resolved growth defaults", async () => {
    const resolutionContext = {
      resolver: {
        resolveCategoryDefault: (c: string) =>
          ({ rate: ({ taxable: 0.05, retirement: 0.06, cash: 0.01, real_estate: 0.04 } as Record<string, number>)[c] }),
      },
    } as unknown as ResolutionContext;
    h.buildRunDeps.mockImplementation(async () => ({
      tree: whatIfTree(),
      resolutionContext,
      loadMcPayload: async () => ({}) as MonteCarloPayload,
      monteCarloSuccess: async () => 0.8,
      now: () => 0,
    }));
    leaveRunning();
    const growthDefaults = { taxable: 0.05, retirement: 0.06, cash: 0.01, realEstate: 0.04 };
    await byName("try_what_if").run({ clientId: "c1", changes: [], includeMonteCarlo: true }, principal);
    expect(h.prepareVariants).toHaveBeenLastCalledWith(expect.anything(), [], expect.any(Array), undefined, { growthDefaults });
    await byName("compare_what_ifs").run(
      { clientId: "c1", variants: [{ label: "A", changes: [] }], includeMonteCarlo: true },
      principal,
    );
    expect(h.prepareVariants).toHaveBeenLastCalledWith(expect.anything(), [], expect.any(Array), undefined, { growthDefaults });
  });
});

describe("compare_what_ifs", () => {
  it("ranks the variations and names the best", async () => {
    const out = (await byName("compare_what_ifs").run(
      {
        clientId: "c1",
        variants: [
          { label: "Retire 60", changes: [{ type: "retirement_age", person: "client", age: 60 }] },
          { label: "Retire 67", changes: [{ type: "retirement_age", person: "client", age: 67 }] },
        ],
        rankBy: { metric: "endingPortfolio" },
      },
      principal,
    )) as { status: string; result: { best: string; variants: { label: string; rank: number }[] } };
    expect(out.status).toBe("done");
    expect(out.result.best).toBe("Retire 67");
    expect(out.result.variants.map((v) => v.rank).sort()).toEqual([1, 2]);
  });

  it("refuses more heavy variations than the cap, and says how to split", async () => {
    const variants = Array.from({ length: 11 }, (_, i) => ({
      label: `V${i}`,
      changes: [],
      solveFor: { kind: "max_spending" as const, targetSuccess: 0.85 },
    }));
    await expect(byName("compare_what_ifs").run({ clientId: "c1", variants }, principal)).rejects.toThrow(
      /at most 10 variations .* Split them into calls of 10/,
    );
  });

  it("refuses a rankBy that can't rank these variations before loading, charging or starting anything", async () => {
    await expect(
      byName("compare_what_ifs").run(
        {
          clientId: "c1",
          variants: [
            { label: "A", changes: [] },
            { label: "B", changes: [{ type: "retirement_age", person: "client", age: 62 }] },
          ],
          rankBy: { metric: "solvedValue" },
        },
        principal,
      ),
    ).rejects.toThrow(new WhatIfValidationError("rankBy solvedValue needs variations with a solveFor. Rank by another measure instead."));
    expect(h.buildRunDeps).not.toHaveBeenCalled();
    expect(h.chargeCompute).not.toHaveBeenCalled();
    expect(h.startWhatIfJob).not.toHaveBeenCalled();
  });

  it("refuses ranking by success rate when nothing runs Monte Carlo, before loading, charging or starting anything", async () => {
    await expect(
      byName("compare_what_ifs").run(
        {
          clientId: "c1",
          variants: [
            { label: "A", changes: [] },
            { label: "Claim at 70", changes: [], solveFor: { kind: "ss_claim_age", person: "client" } },
          ],
          rankBy: { metric: "successRate" },
        },
        principal,
      ),
    ).rejects.toThrow(
      new WhatIfValidationError(
        "rankBy successRate needs Monte Carlo. Set includeMonteCarlo to true, or rank by another measure instead.",
      ),
    );
    expect(h.buildRunDeps).not.toHaveBeenCalled();
    expect(h.chargeCompute).not.toHaveBeenCalled();
    expect(h.startWhatIfJob).not.toHaveBeenCalled();
  });

  it("ranks by success rate when a success-based solve brings Monte Carlo in", async () => {
    h.buildRunDeps.mockImplementation(async () => ({
      tree: whatIfTree(),
      loadMcPayload: async () => ({}) as MonteCarloPayload,
      monteCarloSuccess: async () => 0.8,
      now: () => 0,
      solvers: stubMaxSpending,
    }));
    const out = (await byName("compare_what_ifs").run(
      {
        clientId: "c1",
        variants: [
          { label: "As planned", changes: [] },
          { label: "Most spending", changes: [], solveFor: { kind: "max_spending", targetSuccess: 0.85 } },
        ],
        rankBy: { metric: "successRate" },
      },
      principal,
    )) as { result: { variants: { rank: number | null }[] } };
    expect(out.result.variants.map((v) => v.rank)).toEqual([1, 2]);
  });

  it("runs Monte Carlo on every row when any variation has a success-based solve", async () => {
    h.buildRunDeps.mockImplementation(async () => ({
      tree: whatIfTree(),
      loadMcPayload: async () => ({}) as MonteCarloPayload,
      monteCarloSuccess: async () => 0.8,
      now: () => 0,
      solvers: stubMaxSpending,
    }));
    const out = (await byName("compare_what_ifs").run(
      {
        clientId: "c1",
        variants: [
          { label: "As planned", changes: [] },
          { label: "Most spending", changes: [], solveFor: { kind: "max_spending", targetSuccess: 0.85 } },
        ],
      },
      principal,
    )) as { result: { baseline: { metrics: WhatIfMetrics }; variants: { metrics: WhatIfMetrics }[] } };
    expect(h.startWhatIfJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "compare", total: 2 }));
    expect(h.chargeCompute).toHaveBeenCalledWith(principal, 9); // baseline 1 + two heavy rows × 4
    expect(out.result.baseline.metrics.successRate).toBe(0.8);
    expect(out.result.variants.map((v) => v.metrics.successRate)).toEqual([0.8, 0.8]);
  });
});

describe("the run tools' descriptions", () => {
  it.each(["try_what_if", "compare_what_ifs"])("%s says what income_years refuses and what netToHeirs includes", (name) => {
    const d = byName(name).description;
    expect(d).toMatch(/income_years can't move an income year tied to retirement \(change retirement_age instead\)/);
    expect(d).toMatch(/Social Security row \(change ss_claim_age instead\)/);
    expect(d).toContain('including lifetime gifts — it matches the Solver\'s "Total to Heirs"');
  });

  it.each(["try_what_if", "compare_what_ifs"])("%s explains each solve status in words", (name) => {
    const d = byName(name).description;
    expect(d).toMatch(/'converged'/);
    expect(d).toMatch(/'max-iterations'/);
    expect(d).toMatch(/'unreachable'/);
    expect(d).toMatch(/misses the target/);
  });
});

describe("tryResult and compareResult", () => {
  const metrics = (over: Partial<WhatIfMetrics> = {}): WhatIfMetrics => ({
    successRate: 0.812345678,
    endingPortfolio: 1_234_567.891234,
    lifetimeTax: 456_789.0049,
    netToHeirs: 2_000_000.336,
    heirIncomeTax: null,
    yearsFullyFunded: 30,
    firstShortfallYear: null,
    ...over,
  });
  const row: VariantResult = {
    label: "Roth",
    status: "done",
    metrics: metrics({ successRate: 0.862345678 }),
    deltas: { successRate: 0.05000000000000004, endingPortfolio: -1_000.123456, yearsFullyFunded: 0 },
    solve: { kind: "roth_amount", value: 12_345.678901, status: "converged", achievedSuccess: 0.85123456 },
    caveats: [],
  };
  const out: RunOutput = {
    baseline: { label: "Current plan", status: "done", metrics: metrics(), solve: null, caveats: [] },
    variants: [row],
    unfinished: [],
  };

  it("rounds success rates to 4 decimals and every other metric and delta to cents, leaving solve values alone", () => {
    const t = tryResult(out);
    expect(t.current).toEqual({
      successRate: 0.8123,
      endingPortfolio: 1_234_567.89,
      lifetimeTax: 456_789,
      netToHeirs: 2_000_000.34,
      heirIncomeTax: null,
      yearsFullyFunded: 30,
      firstShortfallYear: null,
    });
    expect(t.whatIf?.successRate).toBe(0.8623);
    expect(t.deltas).toEqual({ successRate: 0.05, endingPortfolio: -1_000.12, yearsFullyFunded: 0 });
    expect(t.solve).toEqual(row.solve);

    const c = compareResult(out, { metric: "endingPortfolio" });
    expect(c.baseline.metrics).toEqual(t.current);
    expect(c.variants[0].metrics).toEqual(t.whatIf);
    expect(c.variants[0].deltas).toEqual(t.deltas);
    expect(c.variants[0].solve).toEqual(row.solve);
  });
});

describe("get_what_if_results", () => {
  it("returns a finished run to the advisor who started it", async () => {
    const kv = memoryKv();
    h.getJobKv.mockReturnValue(kv);
    const job: WhatIfJob = { ...newJob({ firmId: "org_1", userId: "u1", clientId: "c1", kind: "try", total: 1 }), status: "done", result: { x: 1 } };
    await saveJob(kv, job);
    expect(await byName("get_what_if_results").run({ jobId: job.id }, principal)).toMatchObject({ status: "done", result: { x: 1 } });
  });

  it("answers another advisor's run, a missing run, and a run on a client no longer visible the same way", async () => {
    const kv = memoryKv();
    h.getJobKv.mockReturnValue(kv);
    const theirs = newJob({ firmId: "org_1", userId: "someone_else", clientId: "c1", kind: "try", total: 1 });
    const mine = { ...newJob({ firmId: "org_1", userId: "u1", clientId: "c2", kind: "try", total: 1 }), status: "done" as const };
    await saveJob(kv, theirs);
    await saveJob(kv, mine);
    const tool = byName("get_what_if_results");
    await expect(tool.run({ jobId: theirs.id }, principal)).rejects.toThrow(JOB_NOT_FOUND_MESSAGE);
    await expect(tool.run({ jobId: "missing" }, principal)).rejects.toThrow(JOB_NOT_FOUND_MESSAGE);
    h.verifyClientAccessFor.mockResolvedValue({ ok: false });
    await expect(tool.run({ jobId: mine.id }, principal)).rejects.toThrow(JOB_NOT_FOUND_MESSAGE);
  });

  it("lets an access-lookup failure through instead of calling a finished run not found", async () => {
    const kv = memoryKv();
    h.getJobKv.mockReturnValue(kv);
    const mine = { ...newJob({ firmId: "org_1", userId: "u1", clientId: "c1", kind: "try", total: 1 }), status: "done" as const };
    await saveJob(kv, mine);
    h.verifyClientAccessFor.mockRejectedValue(new Error("db connection reset"));
    const err = await byName("get_what_if_results").run({ jobId: mine.id }, principal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toBe(JOB_NOT_FOUND_MESSAGE);
    expect((err as Error).message).toBe("db connection reset");
  });

  it("reports the connector unavailable when the job store can't be read (Review Focus 4)", async () => {
    h.getJobKv.mockReturnValue({
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => "OK",
    } satisfies JobKv);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(byName("get_what_if_results").run({ jobId: "j1" }, principal)).rejects.toBeInstanceOf(
        McpUnavailableError,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("the starting-scenario link", () => {
  it("opens the Solver on a saved starting scenario, and adds nothing for the base case", async () => {
    const start = "44444444-4444-4444-8444-444444444444";
    const fromSaved = (await byName("try_what_if").run({ clientId: "c1", scenarioId: start, changes: [] }, principal)) as {
      scenarioUrl?: string;
    };
    expect(fromSaved.scenarioUrl).toMatch(new RegExp(`/clients/c1/solver\\?scenario=${start}$`));
    const fromBase = await byName("try_what_if").run({ clientId: "c1", changes: [] }, principal);
    expect(fromBase).not.toHaveProperty("scenarioUrl");
  });
});
