import { describe, it, expect } from "vitest";
import {
  inUsageScope,
  newUsageReport,
  recordAiUsage,
  usageStage,
  type UsageReport,
} from "../usage";

/** One call's worth of usage, so the tests read as intent rather than shape. */
function call(model: string, prompt: number, completion: number, cached = 0) {
  recordAiUsage({
    model,
    promptTokens: prompt,
    completionTokens: completion,
    cachedPromptTokens: cached,
  });
}

describe("recordAiUsage", () => {
  it("is a no-op outside a scope", () => {
    expect(() => call("gpt-5.4-mini", 100, 10)).not.toThrow();
  });

  it("accumulates every call into the report the caller holds", async () => {
    const usage = newUsageReport();
    await inUsageScope(usage, async () => {
      call("gpt-5.4-mini", 100, 10);
      call("gpt-5.4-mini", 250, 40, 128);
    });

    expect(usage.total).toEqual({
      calls: 2,
      promptTokens: 350,
      cachedPromptTokens: 128,
      completionTokens: 50,
    });
  });

  it("splits totals by model, so a cheap read and an expensive top-up are separable", async () => {
    const usage = newUsageReport();
    await inUsageScope(usage, async () => {
      call("gpt-5.4-mini", 100, 10);
      call("gpt-5.6-sol", 9000, 900);
    });

    expect(usage.byModel["gpt-5.4-mini"].promptTokens).toBe(100);
    expect(usage.byModel["gpt-5.6-sol"].promptTokens).toBe(9000);
    expect(usage.byModel["gpt-5.6-sol"].calls).toBe(1);
  });

  it("attributes calls to the innermost stage", async () => {
    const usage = newUsageReport();
    await inUsageScope(usage, async () => {
      await usageStage("read", async () => call("mini", 100, 10));
      await usageStage("holdings", async () => {
        call("full", 9000, 900);
        call("full", 9000, 800);
      });
    });

    expect(usage.byStage.read.calls).toBe(1);
    expect(usage.byStage.holdings.calls).toBe(2);
    expect(usage.byStage.holdings.promptTokens).toBe(18000);
  });

  it("attributes a call made outside any stage rather than dropping it", async () => {
    const usage = newUsageReport();
    await inUsageScope(usage, async () => call("mini", 100, 10));

    expect(usage.total.calls).toBe(1);
    expect(Object.values(usage.byStage).reduce((n, s) => n + s.calls, 0)).toBe(1);
  });

  it("keeps concurrent scopes apart — five files extract at once", async () => {
    const reports: UsageReport[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map(async (n) => {
        const usage = newUsageReport();
        reports[n - 1] = usage;
        await inUsageScope(usage, async () => {
          // Yield, so every scope is interleaved mid-flight before any finishes.
          await new Promise((r) => setTimeout(r, 1));
          call("mini", n * 100, n);
        });
      }),
    );

    expect(reports.map((r) => r.total.promptTokens)).toEqual([100, 200, 300, 400, 500]);
  });

  it("keeps what was already spent when the scope throws", async () => {
    const usage = newUsageReport();
    await expect(
      inUsageScope(usage, async () => {
        call("mini", 100, 10);
        throw new Error("Blob fetch failed");
      }),
    ).rejects.toThrow("Blob fetch failed");

    // The whole point of handing the report in rather than returning it: a
    // file that failed HALFWAY still spent tokens, and that is exactly the
    // case worth seeing.
    expect(usage.total.promptTokens).toBe(100);
  });

  it("treats missing token counts as zero rather than NaN", async () => {
    const usage = newUsageReport();
    await inUsageScope(usage, async () => {
      recordAiUsage({ model: "mini" });
    });

    expect(usage.total).toEqual({
      calls: 1,
      promptTokens: 0,
      cachedPromptTokens: 0,
      completionTokens: 0,
    });
  });
});
