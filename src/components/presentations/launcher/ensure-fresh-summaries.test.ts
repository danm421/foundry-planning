import { describe, it, expect, vi } from "vitest";
import { ensureFreshSummaries, type PageDescriptor } from "./ensure-fresh-summaries";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-comparison/options-schema";
import type { RetirementComparisonOptions } from "@/lib/presentations/pages/retirement-comparison/types";

function opts(
  partial: Partial<RetirementComparisonOptions> & {
    ai?: Partial<RetirementComparisonOptions["ai"]>;
  } = {},
): RetirementComparisonOptions {
  return {
    ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
    scenarioId: "sc-1",
    ...partial,
    ai: { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT.ai, ...(partial.ai ?? {}) },
  };
}

function rcPage(options: RetirementComparisonOptions): PageDescriptor {
  return { pageId: "retirementComparison", options, scenarioOverride: undefined };
}

function okFetch(body: { markdown: string; generatedAt: string; hash: string }) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

const SERVER = { markdown: "fresh text", generatedAt: "2026-06-05T00:00:00.000Z", hash: "new-hash" };

describe("ensureFreshSummaries", () => {
  it("updates the summary when the server hash differs (stale numbers)", async () => {
    const page = rcPage(opts({ ai: { sourceHash: "old-hash", generatedText: "old text" } }));
    const fetchImpl = okFetch(SERVER);
    const r = await ensureFreshSummaries([page], { clientId: "c1", fetchImpl });
    expect(r.updates).toHaveLength(1);
    expect((r.pages[0].options as RetirementComparisonOptions).ai.generatedText).toBe("fresh text");
    expect((r.pages[0].options as RetirementComparisonOptions).ai.sourceHash).toBe("new-hash");
    expect(r.error).toBeNull();
  });

  it("keeps the existing (possibly edited) text when the hash matches", async () => {
    const page = rcPage(opts({ ai: { sourceHash: "h1", generatedText: "advisor edit" } }));
    const fetchImpl = okFetch({ ...SERVER, hash: "h1" });
    const r = await ensureFreshSummaries([page], { clientId: "c1", fetchImpl });
    expect(r.updates).toHaveLength(0);
    expect((r.pages[0].options as RetirementComparisonOptions).ai.generatedText).toBe("advisor edit");
  });

  it("fills an empty box even when the hash matches", async () => {
    const page = rcPage(opts({ ai: { sourceHash: "h1", generatedText: "" } }));
    const fetchImpl = okFetch({ ...SERVER, hash: "h1" });
    const r = await ensureFreshSummaries([page], { clientId: "c1", fetchImpl });
    expect(r.updates).toHaveLength(1);
    expect((r.pages[0].options as RetirementComparisonOptions).ai.generatedText).toBe("fresh text");
  });

  it("sends scenarioId, tone/length/instructions and targetConfidence", async () => {
    const page = rcPage(opts({ maxSpend: { show: true, targetConfidence: 0.9 } }));
    const fetchImpl = okFetch(SERVER);
    await ensureFreshSummaries([page], { clientId: "c1", fetchImpl });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ scenarioId: "sc-1", targetConfidence: 0.9, force: false });
  });

  it("skips non-RC pages, AI-off pages, and pages with no comparison scenario", async () => {
    const fetchImpl = okFetch(SERVER);
    const pages: PageDescriptor[] = [
      { pageId: "cashFlow", options: { range: "full" }, scenarioOverride: undefined },
      rcPage(opts({ showAiSummary: false })),
      rcPage(opts({ scenarioId: "" })),
    ];
    const r = await ensureFreshSummaries(pages, { clientId: "c1", fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.updates).toHaveLength(0);
  });

  it("returns an error and leaves the descriptor unchanged when the request fails", async () => {
    const page = rcPage(opts({ ai: { sourceHash: "h1", generatedText: "keep me" } }));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "rate limited" }) });
    const r = await ensureFreshSummaries([page], { clientId: "c1", fetchImpl });
    expect(r.error).toBe("rate limited");
    expect(r.updates).toHaveLength(0);
    expect((r.pages[0].options as RetirementComparisonOptions).ai.generatedText).toBe("keep me");
  });
});
