import { describe, it, expect, vi } from "vitest";
import { generateChapter } from "../generate";
import { moneyFact, pctFact } from "../facts";
import type { StoryContext } from "../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Retire at 62 + Roth",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [],
  facts: [pctFact("outcome.confidence.proposed", "Confidence, proposed", 0.91), moneyFact("today.netWorth", "Net worth", 2_100_000)],
};

const GOOD =
  "Your plan holds. In 91% of the futures we tested the money lasts, which is about as good a place to stand as we see. You're starting from $2.1M.";

/** One invented figure — a single Gate 1 failure and nothing else. */
const ONE_FIGURE = "Your plan grows to $3.4M, which is great news for you.";

/**
 * A draft that breaks all four gates at once, and repeats the ONE shape that can
 * emit a byte-identical pair of failures: Gate 3 maps over sentences with no
 * seen-set, so the same offending sentence in two paragraphs is reported twice.
 * Measured: 8 failures — 1 facts, 2 readability, 2 advice (identical), 3 voice.
 */
const BAD_EVERY_GATE = [
  "# Your plan",
  "",
  "## In summary",
  "",
  "Sell your Apple shares. Your net worth is $3.4M today.",
  "The decumulation phase is what we call this, and it is robust.",
  "The plan is clearer, simpler, and more effective.",
  "Sell your Apple shares.",
].join("\n");

/**
 * The strategy label an advisor typed, echoed at the head of a sentence. Gate 3
 * rejects it for opening a clause with a base-form action verb — there is no
 * holding here to stop instructing.
 */
const LABEL_ECHO =
  "Convert to Roth is the first of the two changes we're making this year.\n" +
  "Your confidence lands at 91%, and the plan holds from there.";

const ADVICE_SENTENCE = 'Rewrite: "Sell your Apple shares."';

function deps(generate: (s: string, u: string) => Promise<string>) {
  return { generate, getCached: async () => null, setCached: async () => {} };
}

/** The user prompt of the retry — the second call's second argument. */
function retryPrompt(gen: { mock: { calls: unknown[][] } }): string {
  return gen.mock.calls[1][1] as string;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("generateChapter", () => {
  it("returns model output that clears every gate", async () => {
    const gen = vi.fn().mockResolvedValue(GOOD);
    const res = await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    expect(res.markdown).toBe(GOOD);
    expect(res.aiSuppressed).toBe(false);
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once when a gate fails, and keeps the clean second attempt", async () => {
    const gen = vi.fn().mockResolvedValueOnce(ONE_FIGURE).mockResolvedValueOnce(GOOD);
    const res = await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    expect(gen).toHaveBeenCalledTimes(2);
    expect(res.markdown).toBe(GOOD);
    expect(res.aiSuppressed).toBe(false);
  });

  it("names the broken rule in the retry prompt", async () => {
    const gen = vi.fn().mockResolvedValueOnce(ONE_FIGURE).mockResolvedValueOnce(GOOD);
    await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    expect(retryPrompt(gen)).toContain("$3.4M");
  });

  it("falls back to the deterministic narrative when the retry also fails", async () => {
    const gen = vi.fn().mockResolvedValue(ONE_FIGURE);
    const res = await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    expect(gen).toHaveBeenCalledTimes(2);
    expect(res.aiSuppressed).toBe(true);
    expect(res.markdown).toContain("91%");
    expect(res.markdown).not.toContain("$3.4M");
  });

  it("falls back rather than throwing when the model call errors", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const gen = vi.fn().mockRejectedValue(new Error("azure exploded"));
    const res = await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    expect(res.aiSuppressed).toBe(true);
    expect(res.markdown.length).toBeGreaterThan(0);
    quiet.mockRestore();
  });

  it("reports an outage as an outage, not as a gate finding", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const gen = vi.fn().mockRejectedValue(new Error("azure exploded"));
    const res = await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    // The advisor's review panel groups `failures` by gate. Filing an outage
    // under one tells them the model wrote a bad figure, which it never did.
    expect(res.failures).toEqual([]);
    expect(res.error).toBe("The writing assistant was unavailable.");
    // …and the raw Azure wording never reaches the advisor.
    expect(res.error).not.toContain("azure exploded");
    quiet.mockRestore();
  });

  it("serves a cache hit without calling the model", async () => {
    const gen = vi.fn();
    const res = await generateChapter({
      clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [],
      deps: { generate: gen, getCached: async () => ({ markdown: GOOD, generatedAt: "2026-08-11T00:00:00Z" }), setCached: async () => {} },
    });
    expect(gen).not.toHaveBeenCalled();
    expect(res.markdown).toBe(GOOD);
  });

  it("returns a stable sourceHash for identical inputs", async () => {
    const args = { clientId: "c1", chapterId: "planInOnePage" as const, ctx: CTX, voiceSamples: [], deps: deps(async () => GOOD) };
    const a = await generateChapter(args);
    const b = await generateChapter(args);
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.sourceHash).toHaveLength(64);
  });

  it("writes the clean chapter to the cache under the source hash", async () => {
    const setCached = vi.fn().mockResolvedValue(undefined);
    const res = await generateChapter({
      clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [],
      deps: { generate: async () => GOOD, getCached: async () => null, setCached },
    });
    expect(setCached).toHaveBeenCalledWith("c1", res.sourceHash, { markdown: GOOD, generatedAt: res.generatedAt });
  });

  it("keeps the chapter when the cache write fails", async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await generateChapter({
      clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [],
      deps: { generate: async () => GOOD, getCached: async () => null, setCached: async () => { throw new Error("redis down"); } },
    });
    // A cache miss on the next run is cheap; suppressing a chapter we already
    // hold is not.
    expect(res.markdown).toBe(GOOD);
    expect(res.aiSuppressed).toBe(false);
    quiet.mockRestore();
  });

  it("skips the cache read when forced", async () => {
    const getCached = vi.fn().mockResolvedValue({ markdown: "stale text", generatedAt: "2026-01-01T00:00:00Z" });
    const res = await generateChapter({
      clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], force: true,
      deps: { generate: async () => GOOD, getCached, setCached: async () => {} },
    });
    expect(getCached).not.toHaveBeenCalled();
    expect(res.markdown).toBe(GOOD);
  });

  it("falls back rather than rendering a blank chapter when the model returns nothing", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const gen = vi.fn().mockResolvedValue("   \n  ");
    const res = await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    // An empty draft clears all four gates — there is nothing in it to reject —
    // so only this guard stands between a blank completion and a blank page.
    expect(res.markdown).toContain("91%");
    expect(res.aiSuppressed).toBe(true);
    expect(res.error).toBe("The writing assistant was unavailable.");
    quiet.mockRestore();
  });

  it("carries every distinct broken rule into the retry, and a repeated one only once", async () => {
    const gen = vi.fn().mockResolvedValueOnce(BAD_EVERY_GATE).mockResolvedValueOnce(GOOD);
    await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    const retry = retryPrompt(gen);
    // Nothing is capped away: one rule from each gate, including the last one
    // the runner emits.
    expect(retry).toContain("$3.4M");
    expect(retry).toContain("decumulation");
    expect(retry).toContain(ADVICE_SENTENCE);
    expect(retry).toContain("clearer, simpler, and more");
    // …but the byte-identical pair Gate 3 can emit is stated once.
    expect(occurrences(retry, ADVICE_SENTENCE)).toBe(1);
  });

  it("tells the retry that a flagged sentence may name no holding at all", async () => {
    const gen = vi.fn().mockResolvedValueOnce(LABEL_ECHO).mockResolvedValueOnce(GOOD);
    await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    const retry = retryPrompt(gen);
    // Gate 3's own message sends the model looking for a holding to stop
    // trading. There is none here — the sentence was rejected for opening on a
    // base-form action verb, which is the half the message never states.
    expect(retry).toContain("Convert to Roth is the first of the two changes");
    expect(retry).toContain("do not open a sentence or a clause with one of the action words listed in your instructions");
  });

  it("adds no advice note when the advice gate did not fire", async () => {
    const gen = vi.fn().mockResolvedValueOnce(ONE_FIGURE).mockResolvedValueOnce(GOOD);
    await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    expect(retryPrompt(gen)).not.toContain("do not open a sentence or a clause");
  });

  it("shows the review panel each broken rule once", async () => {
    const gen = vi.fn().mockResolvedValue(BAD_EVERY_GATE);
    const res = await generateChapter({ clientId: "c1", chapterId: "planInOnePage", ctx: CTX, voiceSamples: [], deps: deps(gen) });
    expect(res.aiSuppressed).toBe(true);
    const advice = res.failures.filter((f) => f.message.includes(ADVICE_SENTENCE));
    expect(advice).toHaveLength(1);
    // The panel still sees every distinct rule — dedup removes repeats, not rules.
    expect(res.failures).toHaveLength(7);
    // The retry's advice note is guidance for the model, not a finding about the
    // advisor's chapter, so it may never appear in the panel.
    expect(res.failures.some((f) => f.message.includes("action words listed"))).toBe(false);
    // Gates rejected this draft; nothing was down.
    expect(res.error).toBeNull();
  });
});
