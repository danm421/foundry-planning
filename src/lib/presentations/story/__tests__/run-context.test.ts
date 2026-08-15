// The staleness comparison is only worth anything if the hash `generate.ts`
// stores is the hash the staleness route rebuilds. They are one function now
// (`chapters/prompts.ts`), so what is left to go wrong is the ARGUMENTS — which
// is what the pin below tests: against a real `generateChapter` result, with and
// without each half of an advisor's voice. A mismatch of a single character
// reports EVERY chapter on every report out of date, permanently.
import { describe, it, expect, vi, beforeEach } from "vitest";

// `generate.ts` reaches Azure through this module. Every case here injects
// `deps.generate`, so it is never called — the mock only keeps the import from
// building a client.
vi.mock("@/lib/extraction/azure-client", () => ({ callAIExtractionWithMeta: vi.fn() }));

const mocks = vi.hoisted(() => ({
  loadStoryContext: vi.fn(),
  loadVoiceProfile: vi.fn(),
  listVoiceSamples: vi.fn(),
}));
vi.mock("../load-context", () => ({ loadStoryContext: mocks.loadStoryContext }));
// `loadStoryRun` resolves the voice out of these two, and both reach `db`.
// Without this mock, importing `../run-context` constructs a real Neon pool for
// the whole file — the fourteen-chapter pin included, which does not go near a
// database otherwise — and the `loadStoryRun` cases below would query it.
vi.mock("../voice/repo", () => ({
  loadVoiceProfile: mocks.loadVoiceProfile,
  listVoiceSamples: mocks.listVoiceSamples,
}));

import { loadStoryRun } from "../run-context";
import { chapterSourceHash } from "../chapters/prompts";
import { generateChapter } from "../generate";
import { CHAPTERS } from "../chapters/registry";
import { moneyFact, pctFact } from "../facts";
import {
  CHAPTER_IDS,
  DEFAULT_CHAPTER_STYLE,
  type ChapterStyle,
  type StoryContext,
} from "../types";
import { EMPTY_VOICE, type StoryVoice } from "../voice/resolve";

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
  // The default is an advisor with nothing stored; the cases that care override.
  mocks.loadVoiceProfile.mockResolvedValue(null);
  mocks.listVoiceSamples.mockResolvedValue([]);
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
      voice: EMPTY_VOICE,
      style: DEFAULT_CHAPTER_STYLE,
      deps,
    });
    expect(chapterSourceHash(chapterId, CTX, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE)).toBe(generated.sourceHash);
  });

  /**
   * ⭐⭐ …and the argument the whole design turns on. `EMPTY_VOICE` is a value
   * both sides can reach by accident; a non-empty list agrees only if the
   * rebuilt hash was given the samples the run was written with. The second
   * assertion is why `StoryRun` carries the voice rather than each caller
   * writing an empty one: with real samples in play, a staleness check that
   * hardcoded the empty voice matches NOTHING.
   */
  it("matches a generation written with voice samples, and only with them", async () => {
    const voice: StoryVoice = { styleNote: "", samples: ["We keep this plain. No jargon, ever."] };
    const generated = await generateChapter({
      clientId: "c1",
      chapterId: "planInOnePage",
      ctx: CTX,
      voice,
      style: DEFAULT_CHAPTER_STYLE,
      deps,
    });
    expect(chapterSourceHash("planInOnePage", CTX, voice, DEFAULT_CHAPTER_STYLE)).toBe(generated.sourceHash);
    expect(chapterSourceHash("planInOnePage", CTX, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE)).not.toBe(generated.sourceHash);
  });

  /**
   * ⭐⭐ …and the SAME question of the other half, because the voice has two and
   * a hash input is only pinned by the assertion that names it. The style note is
   * its own system-prompt line, so a side that carried the samples across but
   * dropped the note matches nothing for every advisor who has written one — and
   * every one of their chapters reads permanently out of date.
   */
  it("matches a generation written with a style note, and only with it", async () => {
    const voice: StoryVoice = { styleNote: "Short sentences. Never any jargon.", samples: [] };
    const generated = await generateChapter({
      clientId: "c1",
      chapterId: "planInOnePage",
      ctx: CTX,
      voice,
      style: DEFAULT_CHAPTER_STYLE,
      deps,
    });
    expect(chapterSourceHash("planInOnePage", CTX, voice, DEFAULT_CHAPTER_STYLE)).toBe(generated.sourceHash);
    expect(chapterSourceHash("planInOnePage", CTX, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE)).not.toBe(generated.sourceHash);
  });

  /**
   * ⭐⭐ …and the SECOND hash input that is not on the run.
   *
   * The advisor's per-chapter tone and length travel on the REQUEST — the
   * generate route reads them off its body, the staleness route off its query —
   * so unlike the voice there is no shared object making the two agree. The
   * threading is all that does, and this is what pins it: the recomputed hash
   * matches only when it is given the style the run was written in.
   *
   * Both assertions, because they kill different things and each one alone is
   * satisfied by a real defect. Dropping `style` on the way into either prompt
   * function fails the FIRST. A `chapterSourceHash` that ignores its style
   * argument altogether passes it — both sides then agree, at the wrong value —
   * and fails the SECOND; measured, that is exactly what this file reported
   * before the argument existed.
   */
  it("matches a generation written in a chosen style, and only in that style", async () => {
    const style: ChapterStyle = { tone: "direct", length: "full" };
    const generated = await generateChapter({
      clientId: "c1",
      chapterId: "planInOnePage",
      ctx: CTX,
      voice: EMPTY_VOICE,
      style,
      deps,
    });
    expect(chapterSourceHash("planInOnePage", CTX, EMPTY_VOICE, style)).toBe(generated.sourceHash);
    expect(chapterSourceHash("planInOnePage", CTX, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE)).not.toBe(
      generated.sourceHash,
    );
  });

  // Kills: a hash that ignores the chapter. Staleness would then be one answer
  // for the whole report, so an edit that moved one chapter's figures would
  // flag all fourteen.
  it("gives different chapters different hashes", () => {
    const hashes = new Set(CHAPTER_IDS.map((id) => chapterSourceHash(id, CTX, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE)));
    expect(hashes.size).toBe(CHAPTER_IDS.length);
  });

  // Kills: a hash that ignores the FACTS — the whole point of the comparison.
  // A constant hash reports nothing stale, ever, and the badge is dead code
  // that looks alive.
  it("moves when the plan behind the chapter moves", () => {
    const before = chapterSourceHash("planInOnePage", CTX, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE);
    const after = chapterSourceHash(
      "planInOnePage",
      { ...CTX, facts: [...CTX.facts, moneyFact("today.netWorth", "Net worth", 2_400_000)] },
      EMPTY_VOICE,
      DEFAULT_CHAPTER_STYLE,
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
    expect(
      chapterSourceHash("planInOnePage", { ...CTX, facts: [...CTX.facts, elsewhere] }, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE),
    ).toBe(chapterSourceHash("planInOnePage", CTX, EMPTY_VOICE, DEFAULT_CHAPTER_STYLE));
  });
});

describe("loadStoryRun", () => {
  it("loads a base-only story with no proposal chapter in its candidate list", async () => {
    const { candidates, voice } = await loadStoryRun({
      clientId: "c1",
      firmId: "f1",
      advisorUserId: "u1",
      scenarioId: "base",
      documentRole: "standalone",
    });
    expect(candidates).toEqual(CHAPTER_IDS.filter((c) => !CHAPTERS[c].requiresProposal));
    // An advisor with no profile row and no samples resolves to the empty voice
    // — which is read off the RUN by both the generating side and the staleness
    // side, so the two cannot be handed different ones. See the pin above for
    // what that would cost.
    expect(voice).toEqual(EMPTY_VOICE);
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
      advisorUserId: "u1",
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

  /**
   * ⭐ Kills: a run that never asks for the voice at all. The empty voice is
   * what an advisor with nothing stored gets AND what a `loadStoryRun` that
   * dropped the resolver would return, so the assertion above cannot tell them
   * apart — this one supplies rows that are not empty and reads the result off
   * the run.
   *
   * The disabled sample is here because it is the difference the two routes
   * would come apart over: a caller resolving the voice for itself, from the
   * same rows, is one `enabled` check away from a different hash.
   */
  it("carries the advisor's resolved voice on the run", async () => {
    mocks.loadVoiceProfile.mockResolvedValue({
      firmId: "f1",
      advisorUserId: "u1",
      styleNote: "Plain words, short sentences.",
    });
    mocks.listVoiceSamples.mockResolvedValue([
      { text: "We keep this plain. No jargon, ever.", enabled: true },
      { text: "Turned off, and never sent.", enabled: false },
    ]);
    const { voice } = await loadStoryRun({
      clientId: "c1",
      firmId: "f1",
      advisorUserId: "u1",
      scenarioId: "base",
      documentRole: "standalone",
    });
    expect(voice).toEqual({
      styleNote: "Plain words, short sentences.",
      samples: ["We keep this plain. No jargon, ever."],
    });
    // …and asked for THIS advisor at THIS firm. A run that read the firm default
    // for everybody would still return a voice, and it would be the wrong one.
    expect(mocks.loadVoiceProfile).toHaveBeenCalledWith("f1", "u1");
    expect(mocks.listVoiceSamples).toHaveBeenCalledWith("f1", "u1");
  });
});
