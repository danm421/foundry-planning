import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtraction: vi.fn() }));

import { callAIExtraction } from "@/lib/extraction/azure-client";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { buildSecondReadInput, generateSecondRead, SECOND_READ_TOTAL_CHARS } from "../generate";

const AT = "2026-08-10T12:00:00.000Z";

function facts() {
  const f = emptyTaxReturnFacts(2024);
  f.income.agi = 412_000;
  f.filingStatus = "married_joint";
  return f;
}

function source(over: Partial<{ documentId: string; role: string; filename: string | null; text: string }> = {}) {
  return { documentId: "d1", role: "full_return", filename: "1040.pdf", text: "Form 1040", ...over };
}

const ONE_ITEM = JSON.stringify({
  items: [{
    headline: "Form 8283 noncash gift may need a qualified appraisal",
    detail: "The packet includes a Form 8283 Section B reporting donated property.",
    form: "Form 8283", line: "Section B", quotedValue: "$28,500",
  }],
});

beforeEach(() => vi.clearAllMocks());

describe("buildSecondReadInput", () => {
  it("labels each document by role and filename so the model can cite it", () => {
    const input = buildSecondReadInput({
      sources: [source({ role: "k1", filename: "ridgeline-k1.pdf", text: "Schedule K-1" })],
      facts: facts(), findingHeadlines: [],
    });
    expect(input).toContain("ridgeline-k1.pdf");
    expect(input).toContain("k1");
    expect(input).toContain("Schedule K-1");
  });

  it("includes the already-fired finding headlines so the model can avoid them", () => {
    const input = buildSecondReadInput({
      sources: [source()], facts: facts(),
      findingHeadlines: ["Roth conversion headroom of $41,000 remains in the 24% bracket"],
    });
    expect(input).toContain("Roth conversion headroom of $41,000 remains in the 24% bracket");
  });

  it("says so explicitly when the rules engine fired nothing", () => {
    const input = buildSecondReadInput({ sources: [source()], facts: facts(), findingHeadlines: [] });
    expect(input).toMatch(/no findings/i);
  });

  it("keeps a small supporting document intact next to a huge 1040", () => {
    const input = buildSecondReadInput({
      sources: [
        source({ documentId: "d1", filename: "1040.pdf", text: "X".repeat(400_000) }),
        source({ documentId: "d2", role: "other", filename: "8283.pdf", text: "Y".repeat(3_000) }),
      ],
      facts: facts(), findingHeadlines: [],
    });
    expect(input).toContain("Y".repeat(3_000));
    expect(input.length).toBeLessThan(SECOND_READ_TOTAL_CHARS + 5_000);
  });
});

describe("generateSecondRead", () => {
  it("mints stable ids and marks nothing dismissed", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(ONE_ITEM);
    const read = await generateSecondRead({
      sources: [source()], facts: facts(), findingHeadlines: [], sourceWarnings: [], generatedAt: AT,
    });
    expect(read.items).toHaveLength(1);
    expect(read.items[0].id).toBe("sr-1");
    expect(read.items[0].dismissed).toBe(false);
    expect(read.items[0].quotedValue).toBe("$28,500");
    expect(read.generatedAt).toBe(AT);
  });

  it("uses the analysis model, not the mini extraction model", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(ONE_ITEM);
    await generateSecondRead({
      sources: [source()], facts: facts(), findingHeadlines: [], sourceWarnings: [], generatedAt: AT,
    });
    expect(vi.mocked(callAIExtraction).mock.calls[0][2]).toBe("full");
  });

  it("caps the list at MAX_SECOND_READ_ITEMS however many the model returns", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({
        items: Array.from({ length: 20 }, (_, i) => ({ headline: `h${i}`, detail: "d" })),
      }),
    );
    const read = await generateSecondRead({
      sources: [source()], facts: facts(), findingHeadlines: [], sourceWarnings: [], generatedAt: AT,
    });
    expect(read.items).toHaveLength(6);
    expect(read.items.map((i) => i.id)).toEqual(["sr-1", "sr-2", "sr-3", "sr-4", "sr-5", "sr-6"]);
  });

  it("drops an item that just restates a finding the rules engine already fired", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(
      JSON.stringify({
        items: [
          { headline: "  ROTH conversion headroom remains in the 24% bracket.  ", detail: "d" },
          { headline: "Form 8283 noncash gift may need an appraisal", detail: "d" },
        ],
      }),
    );
    const read = await generateSecondRead({
      sources: [source()], facts: facts(),
      findingHeadlines: ["Roth conversion headroom remains in the 24% bracket"],
      sourceWarnings: [], generatedAt: AT,
    });
    expect(read.items.map((i) => i.headline)).toEqual(["Form 8283 noncash gift may need an appraisal"]);
    // Ids are minted AFTER the drop, so the surviving item is sr-1, not sr-2.
    expect(read.items[0].id).toBe("sr-1");
  });

  it("carries the source warnings through so the panel can say what wasn't read", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue(JSON.stringify({ items: [] }));
    const read = await generateSecondRead({
      sources: [source()], facts: facts(), findingHeadlines: [],
      sourceWarnings: ["k1.pdf couldn't be read from the document vault."], generatedAt: AT,
    });
    expect(read.warnings).toEqual(["k1.pdf couldn't be read from the document vault."]);
    expect(read.items).toEqual([]);
  });

  it("returns an empty read rather than throwing when the model answers with junk", async () => {
    vi.mocked(callAIExtraction).mockResolvedValue("I'm sorry, I can't help with that.");
    const read = await generateSecondRead({
      sources: [source()], facts: facts(), findingHeadlines: [], sourceWarnings: [], generatedAt: AT,
    });
    expect(read.items).toEqual([]);
    expect(read.warnings).toContain("The second read didn't return anything usable this time.");
  });

  it("throws when the AI call itself fails — the route turns that into a 502", async () => {
    vi.mocked(callAIExtraction).mockRejectedValue(new Error("azure 500"));
    await expect(
      generateSecondRead({
        sources: [source()], facts: facts(), findingHeadlines: [], sourceWarnings: [], generatedAt: AT,
      }),
    ).rejects.toThrow(/azure 500/);
  });

  it("never calls the model when no document could be read", async () => {
    const read = await generateSecondRead({
      sources: [], facts: facts(), findingHeadlines: [],
      sourceWarnings: ["1040.pdf couldn't be read from the document vault."], generatedAt: AT,
    });
    expect(callAIExtraction).not.toHaveBeenCalled();
    expect(read.items).toEqual([]);
    expect(read.warnings).toEqual(["1040.pdf couldn't be read from the document vault."]);
  });
});
