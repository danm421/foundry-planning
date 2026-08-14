// The staleness comparison is only worth anything if the hash `generate.ts`
// stores is the hash the staleness route rebuilds. They are one function now
// (`chapters/prompts.ts`), so what is left to go wrong is the ARGUMENTS — which
// is what the pin below tests: against a real `generateChapter` result, with and
// without voice samples. A mismatch of a single character reports EVERY chapter
// on every report out of date, permanently.
import { describe, it, expect, vi, beforeEach } from "vitest";

// `generate.ts` reaches Azure through this module. Every case here injects
// `deps.generate`, so it is never called — the mock only keeps the import from
// building a client.
vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtractionWithMeta: vi.fn() }));

const mocks = vi.hoisted(() => ({ loadStoryContext: vi.fn() }));
vi.mock("../load-context", () => ({ loadStoryContext: mocks.loadStoryContext }));

import { loadStoryRun } from "../run-context";
import { chapterSourceHash } from "../chapters/prompts";
import { generateChapter } from "../generate";
import { CHAPTERS } from "../chapters/registry";
import { moneyFact, pctFact } from "../facts";
import { CHAPTER_IDS, type StoryContext } from "../types";

const CTX: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Retire at 62 + Roth",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [{ name: "Convert to Roth", rows: [] }],
  goals: [],
  facts: [
    pctFact("outcome.confidence.proposed", "Confidence, proposed", 0.91),
    moneyFact("today.netWorth", "Net worth", 2_100_000),
    // ⚠️ Load-bearing: ONE chapter-scoped figure, so the pin below runs through
    // `factsForChapter` on both sides. On a pack where every fact is plan-level
    // the scoping is the identity function, and dropping it from either
    // expression passes fourteen tests out of fourteen.
    { ...moneyFact("cover.have", "Cover in force", 500_000), chapters: ["protectingYourFamily"] },
  ],
};

/** Long enough to clear the substance floor and be stored — the hash is
 *  produced either way, but a suppressed chapter is a worse pin. */
const DRAFT = "Your plan holds. The money lasts in most of the futures we tested.";

const deps = { generate: async () => DRAFT, getCached: async () => null, setCached: async () => {} };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadStoryContext.mockResolvedValue(CTX);
});

describe("chapterSourceHash", () => {
  /**
   * ⭐ THE PIN. Every chapter, against the hash a real generation stores.
   *
   * Kills: voice samples or retry notes creeping into either expression, the
   * chapter scoping dropped from one side, the two arguments swapped — every
   * way the recomputed hash can stop being the stored one. All of them look
   * exactly the same in production: a report whose every chapter is flagged
   * out of date the moment it is written.
   */
  it.each(CHAPTER_IDS)("matches what generateChapter stores — %s", async (chapterId) => {
    const generated = await generateChapter({
      clientId: "c1",
      chapterId,
      ctx: CTX,
      voiceSamples: [],
      deps,
    });
    expect(chapterSourceHash(chapterId, CTX, [])).toBe(generated.sourceHash);
  });

  /**
   * ⭐⭐ …and the argument the whole design turns on. `[]` is a value both sides
   * can reach by accident; a non-empty list agrees only if the rebuilt hash was
   * given the samples the run was written with. The second assertion is why
   * `StoryRun` carries them rather than each caller writing `[]`: with real
   * samples in play, a staleness check that hardcoded `[]` matches NOTHING.
   */
  it("matches a generation written with voice samples, and only with them", async () => {
    const samples = ["We keep this plain. No jargon, ever."];
    const generated = await generateChapter({
      clientId: "c1",
      chapterId: "planInOnePage",
      ctx: CTX,
      voiceSamples: samples,
      deps,
    });
    expect(chapterSourceHash("planInOnePage", CTX, samples)).toBe(generated.sourceHash);
    expect(chapterSourceHash("planInOnePage", CTX, [])).not.toBe(generated.sourceHash);
  });

  // Kills: a hash that ignores the chapter. Staleness would then be one answer
  // for the whole report, so an edit that moved one chapter's figures would
  // flag all fourteen.
  it("gives different chapters different hashes", () => {
    const hashes = new Set(CHAPTER_IDS.map((id) => chapterSourceHash(id, CTX, [])));
    expect(hashes.size).toBe(CHAPTER_IDS.length);
  });

  // Kills: a hash that ignores the FACTS — the whole point of the comparison.
  // A constant hash reports nothing stale, ever, and the badge is dead code
  // that looks alive.
  it("moves when the plan behind the chapter moves", () => {
    const before = chapterSourceHash("planInOnePage", CTX, []);
    const after = chapterSourceHash(
      "planInOnePage",
      { ...CTX, facts: [...CTX.facts, moneyFact("today.netWorth", "Net worth", 2_400_000)] },
      [],
    );
    expect(after).not.toBe(before);
  });

  // …and does NOT move for a change the model was never shown. `factsForChapter`
  // scopes the pack, so a figure belonging to another chapter must not flag this
  // one — otherwise regenerating any chapter makes the other thirteen stale.
  it("ignores a figure scoped to a different chapter", () => {
    const elsewhere = {
      ...moneyFact("cover.have", "Cover in force", 500_000),
      chapters: ["protectingYourFamily" as const],
    };
    expect(chapterSourceHash("planInOnePage", { ...CTX, facts: [...CTX.facts, elsewhere] }, [])).toBe(
      chapterSourceHash("planInOnePage", CTX, []),
    );
  });
});

describe("loadStoryRun", () => {
  it("loads a base-only story with no proposal chapter in its candidate list", async () => {
    const { candidates, voiceSamples } = await loadStoryRun({
      clientId: "c1",
      firmId: "f1",
      scenarioId: "base",
      documentRole: "standalone",
    });
    expect(candidates).toEqual(CHAPTER_IDS.filter((c) => !CHAPTERS[c].requiresProposal));
    // Empty until something collects them — but read off the RUN by both the
    // generating side and the staleness side, so the two cannot be handed
    // different ones. See the pin above for what that would cost.
    expect(voiceSamples).toEqual([]);
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        firmId: "f1",
        proposedRef: null,
        scenarioLabel: "Base Case",
        documentRole: "standalone",
        chapters: candidates,
      }),
    );
  });

  // Kills: flattening a real scenario to base — the proposal chapters would
  // never be candidates, so they would never be generated and never be checked
  // for staleness.
  it("carries a proposal's ref and label, and names every chapter", async () => {
    const { candidates } = await loadStoryRun({
      clientId: "c1",
      firmId: "f1",
      scenarioId: "5ce11111-2222-4333-8444-666666666666",
      documentRole: "frontMatter",
    });
    expect(candidates).toEqual([...CHAPTER_IDS]);
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({
        proposedRef: "5ce11111-2222-4333-8444-666666666666",
        scenarioLabel: "the proposed plan",
        documentRole: "frontMatter",
      }),
    );
  });
});
