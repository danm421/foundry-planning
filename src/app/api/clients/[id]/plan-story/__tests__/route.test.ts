import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * What these tests can and cannot see.
 *
 * The repo's WRITERS, the story loader and the generator are mocked — they are
 * IO or an LLM call, and Tasks 8/10/11 own their behaviour.
 *
 * The gates are spies too, so what is proved about them is that each route CALLS
 * them, WITH WHICH CLIENT ID, and before which write — never that a gate itself
 * decides correctly.
 *
 * The client-id half is load-bearing rather than tidy. Both write paths are
 * upserts, so an authorized-but-different client id does not harmlessly match
 * zero rows — it CREATES one. "The gate rejects" tests cannot see that: a
 * rejected gate rejects for everybody, and says nothing about who was checked.
 * So every route below asserts the argument as well as the call, and
 * `requireActiveSubscriptionForFirm` — whose return is void and discarded, so
 * tsc cannot see its removal — is pinned by order as well.
 *
 * Real, and therefore actually exercised: the chapter projection,
 * `resolveChapterText`'s precedence, the `requiresProposal` filter (off the
 * real registry), the scenario-id contract, `authErrorResponse`, and
 * `crossFirmAuditMeta` — though the last of those returns its base unchanged
 * for `access: "own"`, which is every fixture bar one, so exactly one test
 * below covers the stamp it exists to apply.
 *
 * `recordAudit` is a spy: these tests prove the SHAPE the routes pass to it,
 * never that a row lands.
 */
const mocks = vi.hoisted(() => ({
  requireOrgId: vi.fn(),
  requireOrgAndUser: vi.fn(),
  verifyClientAccess: vi.fn(),
  requireClientEditAccess: vi.fn(),
  requireActiveSubscriptionForFirm: vi.fn(),
  recordAudit: vi.fn(),
  listStoryChapters: vi.fn(),
  updateChapterText: vi.fn(),
  markChapterReviewed: vi.fn(),
  upsertGeneratedChapter: vi.fn(),
  loadStoryContext: vi.fn(),
  loadVoiceProfile: vi.fn(),
  listVoiceSamples: vi.fn(),
  generateChapter: vi.fn(),
  checkPlanStoryRateLimit: vi.fn(),
  /** What `select ... from scenarios where id = ? and client_id = ?` returns. */
  scenarioRows: [] as { id: string }[],
}));

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(async () => mocks.scenarioRows) })),
    })),
  },
}));

// Only the two session readers are replaced. `UnauthorizedError` stays real
// because `authErrorResponse` below tests thrown errors with `instanceof`.
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return {
    ...actual,
    requireOrgId: mocks.requireOrgId,
    requireOrgAndUser: mocks.requireOrgAndUser,
  };
});

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: mocks.verifyClientAccess,
  requireClientEditAccess: mocks.requireClientEditAccess,
}));

// `authErrorResponse` and `ForbiddenError` stay REAL. Stubbing the first to
// `() => null` — as the brief's test did — turns every rejected gate into a 500
// and makes the status a rejected caller sees untestable.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireActiveSubscriptionForFirm: mocks.requireActiveSubscriptionForFirm };
});

vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));

// Only the writers are replaced; `resolveChapterText` stays real so the GET
// projection's precedence is tested rather than restated.
vi.mock("@/lib/presentations/story/repo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/presentations/story/repo")>(
    "@/lib/presentations/story/repo",
  );
  return {
    ...actual,
    listStoryChapters: mocks.listStoryChapters,
    updateChapterText: mocks.updateChapterText,
    markChapterReviewed: mocks.markChapterReviewed,
    upsertGeneratedChapter: mocks.upsertGeneratedChapter,
  };
});

vi.mock("@/lib/presentations/story/load-context", () => ({
  loadStoryContext: mocks.loadStoryContext,
}));

// The other half of `loadStoryRun`. Both readers go to the database, and the
// `@/db` stub above answers only the scenario lookup — so they are replaced
// here for the same reason `loadStoryContext` is: this file tests the routes,
// not the voice tables. `resolveVoice` still runs for real, which is what makes
// the hashes below the ones a run would store. What no test here can see is
// whether the two routes resolve the SAME voice; that pin is
// `story/__tests__/run-context.test.ts`, on the one helper they both call.
vi.mock("@/lib/presentations/story/voice/repo", () => ({
  loadVoiceProfile: mocks.loadVoiceProfile,
  listVoiceSamples: mocks.listVoiceSamples,
}));

vi.mock("@/lib/presentations/story/generate", () => ({
  generateChapter: mocks.generateChapter,
}));

// Only the check is replaced. `rateLimitErrorResponse` stays REAL, so what a
// refused caller actually receives — 429 for a firm over its ceiling, 503 for a
// limiter that could not answer, and the Retry-After header on both — is tested
// rather than restated.
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, checkPlanStoryRateLimit: mocks.checkPlanStoryRateLimit };
});

import { ForbiddenError } from "@/lib/authz";
import { GET } from "../route";
import { GET as GET_STALE } from "../stale/route";
import { POST } from "../generate/route";
import { PATCH } from "../[chapterId]/route";
import { chapterSourceHash } from "@/lib/presentations/story/chapters/prompts";
import { EMPTY_VOICE } from "@/lib/presentations/story/voice/resolve";

import { CHAPTERS } from "@/lib/presentations/story/chapters/registry";
import { CHAPTER_IDS } from "@/lib/presentations/story/types";
import type { StoryContext } from "@/lib/presentations/story/types";

/**
 * The context this suite's `loadStoryContext` mock hands the route: no facts at
 * all. Stated once, here, because `BASE_ONLY` below is only right while it
 * matches what the mock in `beforeEach` returns.
 *
 * An empty pack is what makes every COVERAGE chapter's `available` predicate
 * false — no policies on file, nobody reaching 65 — so those chapters are not
 * generated for any household in this file except the one case that supplies
 * the data.
 */
const NO_FACTS: StoryContext = {
  household: { firstNames: "Cooper and Susan", householdName: "the Cooper household" },
  scenarioLabel: "Base",
  documentRole: "standalone",
  hasProposal: false,
  strategies: [],
  goals: [],
  facts: [],
};

/** The chapters a BASE-ONLY story generates: the whole arc, less the ones with
 *  nothing to recommend, less the coverage chapters with no data behind them.
 *  Derived from the registry so a fifteenth chapter joins it by existing. */
const BASE_ONLY = CHAPTER_IDS.filter(
  (id) => !CHAPTERS[id].requiresProposal && (CHAPTERS[id].available?.(NO_FACTS) ?? true),
);

/**
 * One fact per `available`-gated prefix, so a test named for the whole arc
 * still means the whole arc. `available` filters this route as of Task 17 and
 * the four coverage chapters each read their own prefix off the pack — on the
 * empty pack above they would quietly drop out, and a test asserting "every
 * chapter" would be asserting two thirds of one.
 *
 * ONE copy, deliberately: a second gated chapter added to one list and not the
 * other is exactly how "every chapter" stops meaning it.
 */
const GATED_FACTS = [
  { id: "estate.net.base", label: "What reaches your heirs, current plan", display: "$9.2M", raw: 9_200_000 },
  { id: "tax.lifetime.base", label: "Total income tax over the plan, current plan", display: "$1.4M", raw: 1_400_000 },
  { id: "cover.have", label: "Cover in force on Cooper's life", display: "$500K", raw: 500_000 },
  { id: "medicare.lifetime", label: "What Medicare costs, current plan", display: "$420K", raw: 420_000 },
];

const CLIENT_ID = "c1a11111-2222-4333-8444-555555555555";
const SCENARIO_ID = "5ce11111-2222-4333-8444-666666666666";

const req = (url: string, init?: RequestInit): NextRequest =>
  new Request(url, init) as unknown as NextRequest;

const jsonReq = (body: unknown): NextRequest =>
  req("http://x/api/plan-story", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const chapterRow = (over: Partial<Record<string, unknown>> = {}) => ({
  chapterId: "planInOnePage",
  generatedText: null,
  editedText: null,
  sourceHash: null,
  aiSuppressed: false,
  error: null,
  reviewedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scenarioRows = [];
  mocks.requireOrgId.mockResolvedValue("org_1");
  mocks.requireOrgAndUser.mockResolvedValue({ orgId: "org_1", userId: "user_1" });
  // No stored voice, so every hash below is the empty-voice one.
  mocks.loadVoiceProfile.mockResolvedValue(null);
  mocks.listVoiceSamples.mockResolvedValue([]);
  mocks.verifyClientAccess.mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: "firm_1",
    access: "own",
  });
  mocks.requireClientEditAccess.mockResolvedValue({
    client: { id: CLIENT_ID },
    firmId: "firm_1",
    access: "own",
  });
  mocks.requireActiveSubscriptionForFirm.mockResolvedValue(undefined);
  mocks.checkPlanStoryRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 3,
    reset: Date.now() + 60_000,
  });
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.listStoryChapters.mockResolvedValue([]);
  mocks.updateChapterText.mockResolvedValue(undefined);
  mocks.markChapterReviewed.mockResolvedValue(undefined);
  mocks.upsertGeneratedChapter.mockResolvedValue(undefined);
  // Identity-preserving: the loader echoes the document role it was handed, so
  // the value the ROUTE derived is observable at `generateChapter`, which is the
  // only place the model's register is decided.
  mocks.loadStoryContext.mockImplementation(async ({ documentRole }: { documentRole: string }) => ({
    hasProposal: false,
    facts: [],
    strategies: [],
    documentRole,
  }));
  mocks.generateChapter.mockImplementation(async ({ chapterId }: { chapterId: string }) => ({
    chapterId,
    markdown: "Words.",
    sourceHash: "h",
    aiSuppressed: false,
    failures: [],
    error: null,
    generatedAt: "2026-01-01T00:00:00.000Z",
    cached: false,
  }));
});

describe("GET /api/clients/[id]/plan-story", () => {
  // Kills: deleting the `!access.ok` early return.
  it("404s when the caller cannot see the client", async () => {
    mocks.verifyClientAccess.mockResolvedValue({ ok: false });
    const res = await GET(req("http://x/?scenarioId=base"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(res.status).toBe(404);
    expect(mocks.listStoryChapters).not.toHaveBeenCalled();
  });

  // Kills: projecting the stored rows instead of the chapter list (a
  // never-generated chapter would vanish from the panel).
  // All fourteen, in DOCUMENT ORDER — the panel lists the chapters in the order
  // the report prints them, and the order is what makes an advisor working down
  // the list see the same sequence the client will read.
  it("returns one entry per chapter, including never-generated ones", async () => {
    const res = await GET(req("http://x/?scenarioId=base"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, "base", "standalone");
    expect(body.chapters).toHaveLength(CHAPTER_IDS.length);
    expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual([
      ...CHAPTER_IDS,
    ]);
    expect(body.chapters[0]).toMatchObject({
      title: "Your plan, in one page",
      text: "",
      generated: false,
      edited: false,
      aiSuppressed: false,
      error: null,
      reviewed: false,
    });
  });

  // Kills: dropping `error` from the projection — the review panel would show a
  // suppressed chapter with no reason. Also kills losing edit-over-model
  // precedence in `resolveChapterText`.
  it("carries the suppression reason and the advisor's text through", async () => {
    mocks.listStoryChapters.mockResolvedValue([
      chapterRow({
        generatedText: "Model words.",
        editedText: "My words.",
        aiSuppressed: true,
        error: "The writing assistant was unavailable.",
        reviewedAt: new Date("2026-01-02T00:00:00.000Z"),
      }),
    ]);
    const res = await GET(req("http://x/?scenarioId=base"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    const body = await res.json();
    expect(body.chapters[0]).toMatchObject({
      text: "My words.",
      generated: true,
      edited: true,
      aiSuppressed: true,
      error: "The writing assistant was unavailable.",
      reviewed: true,
    });
  });

  /**
   * ⭐ Which rows the panel may offer Regenerate on. The button is absent, not
   * greyed, on a chapter this story could only refuse — so the flag behind it has
   * to be the SAME derivation the generate route refuses with, or a button comes
   * back on a row that answers it with an error.
   *
   * Kills: sending `true` for every chapter; sending the registry's
   * `requiresProposal` unflipped (the button would vanish from the rows that most
   * need it); dropping the field (the panel fails open and shows all fourteen).
   */
  it("marks the chapters a base-only story cannot write", async () => {
    const res = await GET(req("http://x/?scenarioId=base"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    const body = await res.json();
    const byId = new Map(
      body.chapters.map((c: { chapterId: string; candidate: boolean }) => [c.chapterId, c.candidate]),
    );
    // Off the real registry, so a fifteenth chapter joins this assertion by
    // existing rather than by being remembered.
    for (const id of CHAPTER_IDS) {
      expect(byId.get(id)).toBe(!CHAPTERS[id].requiresProposal);
    }
    // …and the five are really there: an assertion that holds because every
    // chapter is writable proves nothing about the flag.
    expect(CHAPTER_IDS.filter((id) => CHAPTERS[id].requiresProposal).length).toBeGreaterThan(0);
  });

  // Kills: keying the flag on `requiresProposal` alone. A proposal report is
  // exactly where the recommendation chapter is worth rewriting, and hiding its
  // button there removes the feature from the story that needs it most.
  it("offers every chapter once the report has a proposal", async () => {
    const res = await GET(req(`http://x/?scenarioId=${SCENARIO_ID}`), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    const body = await res.json();
    expect(body.chapters.every((c: { candidate: boolean }) => c.candidate)).toBe(true);
  });

  // Kills: `verifyClientAccess("OTHER-CLIENT")` — a gate that authorizes one
  // client while the read runs against another. Every other test in this
  // describe passes whatever id the route hands the gate.
  it("authorizes the same client whose chapters it reads", async () => {
    await GET(req("http://x/?scenarioId=base"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(mocks.verifyClientAccess).toHaveBeenCalledWith(CLIENT_ID);
    expect(mocks.verifyClientAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listStoryChapters.mock.invocationCallOrder[0],
    );
  });

  // Kills: hardcoding "base" instead of reading the query string.
  it("scopes the listing to the requested scenario", async () => {
    await GET(req(`http://x/?scenarioId=${SCENARIO_ID}`), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, "standalone");
  });

  // Kills: reading the scenario from the query string but not the role. The two
  // presets store separate rows since 0240, so a listing that ignores the role
  // shows the advisor the full story's text under the brief's heading — and
  // every edit they make from there lands on the wrong row.
  it("lists the role it was asked for", async () => {
    await GET(req("http://x/?scenarioId=base&documentRole=frontMatter"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, "base", "frontMatter");
  });

  // Kills: `roleParam ?? "standalone"` with no validation. A typo would quietly
  // list the other preset's rows, which is indistinguishable from the bug the
  // column was added to fix.
  it("refuses an unrecognised role rather than defaulting", async () => {
    const res = await GET(req("http://x/?scenarioId=base&documentRole=whatever"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(res.status).toBe(400);
    expect(mocks.listStoryChapters).not.toHaveBeenCalled();
  });

  // …and the one case where absence is NOT a caller bug. An old client sending
  // no parameter reads exactly the rows the column's own default says are its,
  // so this is not in tension with the rejection above: an ABSENT parameter is a
  // pre-0240 caller, a PRESENT wrong one is a bug.
  it("defaults a missing role to standalone", async () => {
    await GET(req("http://x/?scenarioId=base"), { params: Promise.resolve({ id: CLIENT_ID }) });
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, "base", "standalone");
  });
});

/**
 * The staleness endpoint. It exists SEPARATELY from the chapter list because
 * answering it costs a whole story context — 23.2s cold, 4.0s warm, measured —
 * and the panel reloads that list after every save.
 *
 * `loadStoryContext` is the mock every other test in this file uses, so the
 * hashes below are real: `chapterSourceHash` runs for real over the same context
 * the route is handed. What is NOT proved here is that the recomputed hash
 * equals what a generation stores — that pin is `story/__tests__/run-context.test.ts`,
 * against a real `generateChapter` result.
 */
describe("GET /api/clients/[id]/plan-story/stale", () => {
  const stale = (query: string) =>
    GET_STALE(req(`http://x/${query}`), { params: Promise.resolve({ id: CLIENT_ID }) });

  /** The hash a generation run against `NO_FACTS` would have stored. */
  const FRESH = chapterSourceHash("planInOnePage", NO_FACTS, EMPTY_VOICE);

  beforeEach(() => {
    mocks.loadStoryContext.mockResolvedValue(NO_FACTS);
  });

  // Kills: dropping the `!access.ok` early return from the one read that then
  // goes on to project another firm's household.
  it("404s when the caller cannot see the client", async () => {
    mocks.verifyClientAccess.mockResolvedValue({ ok: false });
    const res = await stale("?scenarioId=base");
    expect(res.status).toBe(404);
    expect(mocks.listStoryChapters).not.toHaveBeenCalled();
    expect(mocks.loadStoryContext).not.toHaveBeenCalled();
  });

  /**
   * ⭐ Kills: loading the context unconditionally.
   *
   * A report nobody has generated has nothing that CAN be stale, and this is the
   * common case — the panel asks on mount, which is usually the first time the
   * advisor has opened it. Without the short circuit that mount costs twenty
   * seconds of projections to answer with an empty list.
   */
  it("answers a never-generated report without rebuilding the plan", async () => {
    mocks.listStoryChapters.mockResolvedValue([chapterRow({ sourceHash: null })]);
    const res = await stale("?scenarioId=base");
    expect(res.status).toBe(200);
    expect((await res.json()).stale).toEqual([]);
    expect(mocks.loadStoryContext).not.toHaveBeenCalled();
  });

  // Kills: comparing the wrong way round, or returning every stored chapter.
  it("names the chapter whose stored hash no longer matches the plan", async () => {
    mocks.listStoryChapters.mockResolvedValue([
      chapterRow({ chapterId: "planInOnePage", sourceHash: "written-against-an-older-plan" }),
      chapterRow({ chapterId: "whatYouHave", sourceHash: chapterSourceHash("whatYouHave", NO_FACTS, EMPTY_VOICE) }),
    ]);
    const res = await stale("?scenarioId=base");
    expect(await res.json()).toMatchObject({ stale: ["planInOnePage"] });
  });

  // Kills: flagging everything — a badge that is always on is one the advisor
  // learns to ignore, which is worse than no badge at all.
  it("flags nothing when the stored hashes still match", async () => {
    mocks.listStoryChapters.mockResolvedValue([
      chapterRow({ chapterId: "planInOnePage", sourceHash: FRESH }),
    ]);
    expect((await (await stale("?scenarioId=base")).json()).stale).toEqual([]);
  });

  // Kills: rebuilding the context from a different scenario than the rows were
  // listed under. The two would then never agree and every chapter reads stale.
  it("lists and rebuilds under the same scenario and register", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    mocks.listStoryChapters.mockResolvedValue([chapterRow({ sourceHash: "old" })]);
    await stale(`?scenarioId=${SCENARIO_ID}&documentRole=frontMatter`);
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID, "frontMatter");
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        firmId: "firm_1",
        proposedRef: SCENARIO_ID,
        documentRole: "frontMatter",
      }),
    );
  });

  // Kills: taking the scenario on trust, as the chapter list does. That route
  // only reads rows; this one goes on to LOAD the ref, and `loadStoryContext`
  // degrades a snapshot to a proposal with no strategies — a context nothing
  // was ever generated from, so every chapter would read stale.
  it("refuses a snapshot ref rather than hashing against a degraded plan", async () => {
    const res = await stale("?scenarioId=snap:abc");
    expect(res.status).toBe(400);
    expect(mocks.loadStoryContext).not.toHaveBeenCalled();
  });

  // Kills: guessing the preset. The two store separate rows, so the wrong guess
  // compares one preset's hashes against the other's.
  it("refuses an unrecognised role rather than defaulting", async () => {
    const res = await stale("?scenarioId=base&documentRole=whatever");
    expect(res.status).toBe(400);
    expect(mocks.listStoryChapters).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/clients/[id]/plan-story/[chapterId]", () => {
  const patch = (body: unknown, chapterId = "planInOnePage") =>
    PATCH(jsonReq(body), { params: Promise.resolve({ id: CLIENT_ID, chapterId }) });

  // Kills: removing `isChapterId`. Both writers are upserts, so an unguarded
  // chapterId persists a junk row rather than harmlessly matching nothing.
  it("rejects an unknown chapter id without writing", async () => {
    const res = await patch({ scenarioId: "base", documentRole: "standalone", editedText: "hi" }, "nope");
    expect(res.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });

  // Kills: dropping any of the four write args, or any required audit field
  // (`firmId` is required by recordAudit and easy to omit).
  it("saves an edit and records audit", async () => {
    const res = await patch({ scenarioId: "base", documentRole: "standalone", editedText: "My words." });
    expect(res.status).toBe(200);
    expect(mocks.updateChapterText).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      scenarioId: "base",
      documentRole: "standalone",
      chapterId: "planInOnePage",
      editedText: "My words.",
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: "plan_story.chapter_edited",
      resourceType: "plan_story_chapter",
      resourceId: "planInOnePage",
      clientId: CLIENT_ID,
      firmId: "firm_1",
      metadata: { scenarioId: "base", documentRole: "standalone" },
    });
  });

  // Kills: collapsing an empty edit into "no edit". Clearing the box is how an
  // advisor drops their version and lets the model's words render again; read
  // as absent, it is answered 400 and the advisor's version stays put.
  it("treats an empty edit as clearing the advisor's version", async () => {
    const res = await patch({ scenarioId: "base", documentRole: "standalone", editedText: "" });
    expect(res.status).toBe(200);
    expect(mocks.updateChapterText).toHaveBeenCalledWith(
      expect.objectContaining({ editedText: "" }),
    );
  });

  // Kills: `requireClientEditAccess("OTHER-CLIENT")` — the gate that stands in
  // front of two upserts, checked against a client the write will not touch.
  it("authorizes the same client it writes under", async () => {
    await patch({ scenarioId: "base", documentRole: "standalone", editedText: "hi", reviewed: true });
    expect(mocks.requireClientEditAccess).toHaveBeenCalledWith(CLIENT_ID);
    expect(mocks.requireClientEditAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateChapterText.mock.invocationCallOrder[0],
    );
    expect(mocks.requireClientEditAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markChapterReviewed.mock.invocationCallOrder[0],
    );
  });

  // Kills: `markChapterReviewed({… scenarioId: "base" …})`. Every other
  // reviewed:true fixture in this file is on the base story, where a hardcoded
  // "base" is indistinguishable from the resolved one — so an advisor reviewing
  // a proposal's chapter would stamp the base story's row instead.
  it("marks the chapter reviewed on the scenario the advisor is looking at", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    const res = await patch({ scenarioId: SCENARIO_ID, documentRole: "standalone", reviewed: true });
    expect(res.status).toBe(200);
    expect(mocks.markChapterReviewed).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, scenarioId: SCENARIO_ID }),
    );
  });

  // Kills: stamping the org id (or nothing) as the reviewer instead of the
  // acting user — the flag's whole point is who stands behind the words.
  it("marks a chapter reviewed as the acting user", async () => {
    const res = await patch({ scenarioId: "base", documentRole: "standalone", reviewed: true });
    expect(res.status).toBe(200);
    expect(mocks.markChapterReviewed).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      scenarioId: "base",
      documentRole: "standalone",
      chapterId: "planInOnePage",
      userId: "user_1",
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan_story.chapter_reviewed", firmId: "firm_1" }),
    );
  });

  // Kills: reporting success for a body that changes nothing, which reads to
  // the panel exactly like a saved edit.
  it("rejects a body with nothing to change", async () => {
    const res = await patch({ scenarioId: "base", documentRole: "standalone" });
    expect(res.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
    expect(mocks.markChapterReviewed).not.toHaveBeenCalled();
  });

  // Kills: deleting `requireActiveSubscriptionForFirm`, or moving it after the
  // write. Its return is void and discarded, so tsc cannot see its removal and
  // no other test in this file touches it.
  it("clears the firm's subscription before it writes", async () => {
    await patch({ scenarioId: "base", documentRole: "standalone", editedText: "hi" });
    expect(mocks.requireActiveSubscriptionForFirm).toHaveBeenCalledWith("firm_1");
    expect(mocks.requireActiveSubscriptionForFirm.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateChapterText.mock.invocationCallOrder[0],
    );
  });

  // Kills: replacing `crossFirmAuditMeta({ access }, callerOrg, { scenarioId })`
  // with a bare `{ scenarioId }`. Every other fixture is `access: "own"`, for
  // which the real helper returns its base unchanged — so this is the only test
  // in the file where it does anything at all.
  it("stamps a cross-firm edit and review in the audit metadata", async () => {
    mocks.requireClientEditAccess.mockResolvedValue({
      client: { id: CLIENT_ID },
      firmId: "firm_1",
      access: "shared",
    });
    await patch({ scenarioId: "base", documentRole: "standalone", editedText: "hi", reviewed: true });
    const stamped = { scenarioId: "base", documentRole: "standalone", crossFirmActor: true, actorFirmId: "org_1" };
    // Both audit call sites, since each builds its metadata separately.
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan_story.chapter_edited", metadata: stamped }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan_story.chapter_reviewed", metadata: stamped }),
    );
  });

  // Kills: writing ahead of the gate. Both writers are upserts, so a rejected
  // caller that still reached one would CREATE a row rather than harmlessly
  // matching none — the property carried requirement 4 calls the sole barrier.
  it("writes nothing when the edit gate rejects", async () => {
    mocks.requireClientEditAccess.mockRejectedValue(new ForbiddenError("Edit access required"));
    const res = await patch({ scenarioId: "base", documentRole: "standalone", editedText: "hi", reviewed: true });
    expect(res.status).toBe(403);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
    expect(mocks.markChapterReviewed).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  // Kills: hand-rolling `request.json()` instead of validating. An unknown key
  // is a caller sending a field this route does not implement — answering 200
  // tells them it landed. A null body would be a 500 (`null.editedText`).
  it("rejects a body the schema does not accept", async () => {
    const unknownKey = await patch({ scenarioId: "base", documentRole: "standalone", editedText: "hi", bogus: 1 });
    expect(unknownKey.status).toBe(400);
    const nullBody = await patch(null);
    expect(nullBody.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });

  // Kills: taking `body.scenarioId` on trust. Every distinct junk string would
  // otherwise create its own row, invisible to GET and never cleaned up.
  it("refuses a scenario the client does not own", async () => {
    mocks.scenarioRows = [];
    const res = await patch({ scenarioId: SCENARIO_ID, documentRole: "standalone", editedText: "hi" });
    expect(res.status).toBe(404);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });

  // Kills: a guard that rejects everything but "base", which would make a
  // per-scenario story unwritable.
  it("accepts a scenario the client owns", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    const res = await patch({ scenarioId: SCENARIO_ID, documentRole: "standalone", editedText: "hi" });
    expect(res.status).toBe(200);
    expect(mocks.updateChapterText).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: SCENARIO_ID }),
    );
  });

  // Kills: letting a non-uuid reach Postgres, where `scenarios.id` is a uuid
  // column and the cast raises 22P02 — a 500 instead of a rejection.
  it("rejects a malformed scenarioId before it reaches the database", async () => {
    const res = await patch({ scenarioId: "not-a-uuid", documentRole: "standalone", editedText: "hi" });
    expect(res.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });
});

describe("POST /api/clients/[id]/plan-story/generate", () => {
  const post = (body: unknown) =>
    POST(
      req("http://x/api/plan-story/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );

  // Kills: removing the `requiresProposal` filter — a base-only story would
  // publish a recommendation chapter with nothing to recommend.
  it("skips proposal-only chapters for a base-only story", async () => {
    const res = await post({ scenarioId: "base", documentRole: "standalone" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual(BASE_ONLY);
    expect(mocks.upsertGeneratedChapter).toHaveBeenCalledTimes(BASE_ONLY.length);
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, firmId: "firm_1", proposedRef: null }),
    );
    // Kills: storing the base path's chapters under "" — the empty scope the
    // panel and the export loader both translate AWAY from, so the rows would be
    // written where nothing ever reads them. A call count cannot see it.
    expect(mocks.upsertGeneratedChapter).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, scenarioId: "base" }),
    );
  });

  /**
   * Kills: an `available` clause that is always false — a coverage chapter that
   * can never be generated, whatever the household has.
   *
   * Every other case in this file runs on an empty fact pack, so they only ever
   * see these two chapters SKIPPED. That direction is already pinned (drop the
   * clause and `BASE_ONLY` no longer matches), but it is one-sided: skipping is
   * also what a permanently-off predicate does, and the advisor would simply
   * never get the chapter. This is the case that fails for that.
   */
  it("generates a coverage chapter once the household has the data for it", async () => {
    mocks.loadStoryContext.mockResolvedValue({
      hasProposal: false,
      strategies: [],
      facts: [
        {
          id: "cover.have",
          label: "Cover in force on Cooper's life",
          display: "$500K",
          raw: 500_000,
        },
      ],
    });

    const res = await post({ scenarioId: "base", documentRole: "standalone" });
    const body = await res.json();
    const ids = body.chapters.map((c: { chapterId: string }) => c.chapterId);

    expect(res.status).toBe(200);
    expect(ids).toContain("protectingYourFamily");
    // …and only the chapter whose data arrived. The Medicare pack is still
    // absent, so a predicate that answered for its neighbour would show up here
    // rather than in a count that both chapters satisfy.
    expect(ids).not.toContain("healthCareCosts");
  });

  // Kills: `requireClientEditAccess("OTHER-CLIENT")` on the one endpoint that
  // spends money, and `generateChapter({ clientId: "OTHER-CLIENT" })` — which
  // would generate against one client's plan and store under another's.
  it("authorizes the same client it generates and stores for", async () => {
    await post({ scenarioId: "base", documentRole: "standalone" });
    expect(mocks.requireClientEditAccess).toHaveBeenCalledWith(CLIENT_ID);
    expect(mocks.requireClientEditAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateChapter.mock.invocationCallOrder[0],
    );
    expect(mocks.generateChapter).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID }),
    );
  });

  // Kills: hardcoding `documentRole` or `force`. The first is the Executive
  // brief preset's entire behaviour — it is the only thing that switches the
  // prose between standing alone and pointing at the pages after it — and the
  // second is the only way past a 30-day cache entry that cannot be deleted.
  it("carries the caller's document role and force flag into the generator", async () => {
    await post({ scenarioId: "base", documentRole: "frontMatter", force: true });
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ documentRole: "frontMatter" }),
    );
    expect(mocks.generateChapter).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: CLIENT_ID,
        force: true,
        ctx: expect.objectContaining({ documentRole: "frontMatter" }),
      }),
    );
  });

  it("defaults a caller who names no force flag to a cache-reading run", async () => {
    await post({ scenarioId: "base", documentRole: "standalone" });
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ documentRole: "standalone" }),
    );
    expect(mocks.generateChapter).toHaveBeenCalledWith(
      expect.objectContaining({ force: false, ctx: expect.objectContaining({ documentRole: "standalone" }) }),
    );
  });

  // Kills: defaulting an ABSENT role to "standalone" on a WRITE. Since 0240 the
  // role picks which row the words are stored on, so guessing it is the bug the
  // column was added to fix — the brief's chapters landing on the full story's
  // rows. A caller that does not know its own role is a caller bug.
  it("refuses a generation that names no document role", async () => {
    const res = await post({ scenarioId: "base" });
    expect(res.status).toBe(400);
    expect(mocks.loadStoryContext).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedChapter).not.toHaveBeenCalled();
  });

  // …and the same on the edit path, where it would overwrite the other preset's
  // words rather than merely reading them.
  it("refuses an edit that names no document role", async () => {
    const res = await PATCH(jsonReq({ scenarioId: "base", editedText: "hi" }), {
      params: Promise.resolve({ id: CLIENT_ID, chapterId: "planInOnePage" }),
    });
    expect(res.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });

  /**
   * Kills: auditing AFTER the writes. `Promise.all` rejects on the first failing
   * upsert while the ones that already resolved stay committed, so the client
   * keeps some new chapter text, the model calls are paid for, and the only
   * record that anyone regenerated this story never lands.
   */
  it("records the run in the audit log even when a chapter fails to store", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.upsertGeneratedChapter.mockRejectedValueOnce(new Error("write conflict"));
    const res = await post({ scenarioId: "base", documentRole: "standalone" });
    expect(res.status).toBe(500);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan_story.generated", clientId: CLIENT_ID }),
    );
    quiet.mockRestore();
  });

  /**
   * Kills: generating a chapter that has nothing to recommend.
   *
   * `hasProposal` is derived from the REF alone (`load-context.ts`), so a
   * scenario an advisor created but has not edited yet is a proposal with no
   * changes in it. The recommendation chapter's only honest content is then the
   * one sentence the deterministic narrator already writes — and asking a model
   * for it hands `generate.ts` the single shape its substance floor cannot
   * judge: a chapter with nothing supplied to name, where a refusal or an
   * injected echo clears all four gates and is cached for 30 days.
   */
  it("does not generate a recommendation chapter for a proposal with no changes in it", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    mocks.loadStoryContext.mockResolvedValue({ hasProposal: true, facts: [], strategies: [] });
    const res = await post({ scenarioId: SCENARIO_ID, documentRole: "standalone" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual(BASE_ONLY);
    expect(mocks.generateChapter).not.toHaveBeenCalledWith(
      expect.objectContaining({ chapterId: "whatWeRecommend" }),
    );
    expect(mocks.upsertGeneratedChapter).toHaveBeenCalledTimes(BASE_ONLY.length);
  });

  // Kills: inverting that filter, and confirms the proposed ref reaches the
  // loader rather than being flattened to base.
  it("generates every chapter for a proposal, and stores each one", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    // A proposal with a change in it — which is now what "a proposal" means to
    // this route, per the test above.
    mocks.loadStoryContext.mockResolvedValue({
      hasProposal: true,
      facts: GATED_FACTS,
      strategies: [{ name: "Convert to Roth", rows: [] }],
    });
    const res = await post({ scenarioId: SCENARIO_ID, documentRole: "standalone" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chapters).toHaveLength(CHAPTER_IDS.length);
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ proposedRef: SCENARIO_ID }),
    );
    expect(mocks.upsertGeneratedChapter).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, scenarioId: SCENARIO_ID }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "plan_story.generated",
        firmId: "firm_1",
        metadata: expect.objectContaining({
          scenarioId: SCENARIO_ID,
          chapters: CHAPTER_IDS.length,
        }),
      }),
    );
  });

  /**
   * ⭐⭐ THE INVARIANT. The chapter list handed to the loader must be a SUPERSET
   * of what the route actually narrates.
   *
   * The list exists to skip facts nothing will read — the life-cover solve,
   * mainly. Go one chapter too narrow and that chapter is written from a pack
   * missing its own facts, so its narrator prints its honest empty state: a
   * wrong page on a document handed to a client, invisible to every gate, to the
   * page count and to the type system.
   *
   * It holds by construction — `wanted` is a filter OF the candidate set, not a
   * second filter over `CHAPTER_IDS` that happens to agree — and this is
   * what goes red if those two ever come apart again.
   */
  describe("the chapter list handed to the loader", () => {
    const chaptersLoaded = (): string[] => mocks.loadStoryContext.mock.calls[0][0].chapters;

    it("names no proposal chapter for a base-only story", async () => {
      await post({ scenarioId: "base", documentRole: "standalone" });

      expect(chaptersLoaded()).toEqual(
        CHAPTER_IDS.filter((c) => !CHAPTERS[c].requiresProposal),
      );
    });

    /**
     * ⚠️ Derived from the REF ALONE, and deliberately looser than what gets
     * narrated. `available` and `hasSomethingToPropose` are both read off the
     * context the loader RETURNS, so a list that consulted them would be
     * circular. A proposal carrying no changes therefore still loads the
     * recommendation chapter's facts — the correct direction to be wrong in.
     */
    it("still names the recommendation chapter for a proposal carrying no changes", async () => {
      mocks.scenarioRows = [{ id: SCENARIO_ID }];
      mocks.loadStoryContext.mockResolvedValue({ hasProposal: true, facts: [], strategies: [] });

      const res = await post({ scenarioId: SCENARIO_ID, documentRole: "standalone" });
      const body = await res.json();

      expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).not.toContain(
        "whatWeRecommend",
      );
      expect(chaptersLoaded()).toContain("whatWeRecommend");
    });

    // The property itself, over both shapes of run this file exercises: an empty
    // fact pack on base, and a proposal with changes and one fact per gated
    // prefix. Every chapter narrated was one the loader was told to load facts
    // for.
    it.each([
      ["a base-only story", "base", { hasProposal: false, facts: [], strategies: [] }],
      [
        "a proposal with changes",
        SCENARIO_ID,
        {
          hasProposal: true,
          facts: GATED_FACTS,
          strategies: [{ name: "Convert to Roth", rows: [] }],
        },
      ],
    ])("covers every chapter it narrates — %s", async (_name, scenarioId, ctx) => {
      mocks.scenarioRows = [{ id: SCENARIO_ID }];
      mocks.loadStoryContext.mockResolvedValue(ctx);

      const res = await post({ scenarioId, documentRole: "standalone" });
      const body = await res.json();

      const narrated = body.chapters.map((c: { chapterId: string }) => c.chapterId);
      expect(narrated.length).toBeGreaterThan(0);
      expect(chaptersLoaded()).toEqual(expect.arrayContaining(narrated));
    });
  });

  // Kills: letting a `snap:` ref through to the loader, which degrades it to a
  // proposal with zero strategies and no proposed confidence.
  it("refuses a snapshot ref, and says so", async () => {
    const res = await post({ scenarioId: "snap:abc", documentRole: "standalone" });
    expect(res.status).toBe(400);
    // Named, not lumped in with "invalid id": a snapshot is a well-formed ref
    // the feature declines, and the advisor picked it from a real picker.
    expect((await res.json()).error).toMatch(/snapshot/i);
    expect(mocks.loadStoryContext).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedChapter).not.toHaveBeenCalled();
  });

  // Kills: deleting `requireActiveSubscriptionForFirm` from the one endpoint
  // that spends model calls, or moving it after the run.
  it("clears the firm's subscription before it generates", async () => {
    await post({ scenarioId: "base", documentRole: "standalone" });
    expect(mocks.requireActiveSubscriptionForFirm).toHaveBeenCalledWith("firm_1");
    expect(mocks.requireActiveSubscriptionForFirm.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.generateChapter.mock.invocationCallOrder[0],
    );
  });

  // Kills: the third `crossFirmAuditMeta` call site — this route builds its own
  // metadata, so the PATCH cross-firm test cannot cover it.
  it("stamps a cross-firm generation in the audit metadata", async () => {
    mocks.requireClientEditAccess.mockResolvedValue({
      client: { id: CLIENT_ID },
      firmId: "firm_1",
      access: "shared",
    });
    await post({ scenarioId: "base", documentRole: "standalone" });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ crossFirmActor: true, actorFirmId: "org_1" }),
      }),
    );
  });

  // Kills: reaching the model, or the store, past a rejected gate.
  it("generates nothing when the edit gate rejects", async () => {
    mocks.requireClientEditAccess.mockRejectedValue(new ForbiddenError("Edit access required"));
    const res = await post({ scenarioId: "base", documentRole: "standalone" });
    expect(res.status).toBe(403);
    expect(mocks.generateChapter).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedChapter).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
    // …and no token off the firm's budget either. The ceiling is a shared
    // resource, so a caller who may not touch this client must not be able to
    // spend the budget of the firm that can.
    expect(mocks.checkPlanStoryRateLimit).not.toHaveBeenCalled();
  });

  // Kills: coercing an unrecognised documentRole to "standalone". The two roles
  // produce different prose — a self-contained story, or one that points at the
  // pages after it — so a typo must not silently pick one.
  it("rejects an unrecognised documentRole", async () => {
    const res = await post({ scenarioId: "base", documentRole: "frontmatter" });
    expect(res.status).toBe(400);
    expect(mocks.loadStoryContext).not.toHaveBeenCalled();
  });

  // Kills: dropping `error` from the response — an advisor who just clicked
  // Generate would be shown a suppressed chapter with no reason.
  it("reports the outage reason for a suppressed chapter", async () => {
    mocks.generateChapter.mockImplementation(async ({ chapterId }: { chapterId: string }) => ({
      chapterId,
      markdown: "Fallback.",
      sourceHash: "h",
      aiSuppressed: true,
      failures: [],
      error: "The writing assistant was unavailable.",
      generatedAt: "2026-01-01T00:00:00.000Z",
      cached: false,
    }));
    const res = await post({ scenarioId: "base", documentRole: "standalone" });
    const body = await res.json();
    expect(body.chapters[0]).toMatchObject({
      aiSuppressed: true,
      error: "The writing assistant was unavailable.",
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          suppressed: BASE_ONLY,
        }),
      }),
    );
  });

  /**
   * ⭐ One chapter, and the ceiling — deliberately the same change.
   *
   * `force: true` was in the schema and reachable from nothing, and the route
   * had no ceiling at all: fourteen chapters, up to two model calls each, behind
   * one click any advisor can make. A button without the limit hands a firm an
   * uncapped spend; a limit without the button caps a spend nobody could make.
   */
  describe("one chapter, and the ceiling that bounds the spend", () => {
    it("writes only the chapter it was asked for", async () => {
      const res = await post({
        scenarioId: "base",
        documentRole: "standalone",
        chapterId: "whatYouHave",
        force: true,
      });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(mocks.generateChapter).toHaveBeenCalledTimes(1);
      expect(mocks.generateChapter).toHaveBeenCalledWith(
        expect.objectContaining({ chapterId: "whatYouHave", force: true }),
      );
      // Stored, and answered, as the one chapter it is — the panel takes that
      // row's out-of-date badge down from this list.
      expect(mocks.upsertGeneratedChapter).toHaveBeenCalledTimes(1);
      expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual([
        "whatYouHave",
      ]);
    });

    // Kills: `z.string()` in place of the enum. Storage holds `chapter_id` as
    // free text, so an id this build does not know is a row nothing will ever
    // read again — written from a model call someone paid for.
    it("refuses an id that is not a chapter, before it rebuilds the plan", async () => {
      const res = await post({
        scenarioId: "base",
        documentRole: "standalone",
        chapterId: "nope",
      });
      expect(res.status).toBe(400);
      expect(mocks.loadStoryContext).not.toHaveBeenCalled();
      expect(mocks.generateChapter).not.toHaveBeenCalled();
    });

    /**
     * Kills: treating a named chapter as a BYPASS of the filter rather than a
     * filter over it. `whatWeRecommend` needs something in a proposal, and this
     * is a base-only story — the exact refusal the all-chapters path already
     * makes, and the hole a new parameter re-opens by default.
     *
     * Refused off the REF, so it costs nothing: no plan rebuilt, and no token
     * off a budget the firm will want for a request that can succeed.
     */
    it("refuses a chapter this story cannot supply, rather than spending a call on it", async () => {
      const res = await post({
        scenarioId: "base",
        documentRole: "standalone",
        chapterId: "whatWeRecommend",
      });
      expect(res.status).toBe(400);
      expect(mocks.loadStoryContext).not.toHaveBeenCalled();
      expect(mocks.checkPlanStoryRateLimit).not.toHaveBeenCalled();
      expect(mocks.generateChapter).not.toHaveBeenCalled();
      expect(mocks.upsertGeneratedChapter).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
    });

    /**
     * …and the half of that refusal the ref CANNOT answer. A coverage chapter
     * with no policies behind it is a chapter this household's facts cannot
     * supply, which is only knowable once the facts exist — so this one is
     * refused after the load rather than before it, and still without a model
     * call.
     */
    it("refuses a chapter the household has no data for, once the facts say so", async () => {
      const res = await post({
        scenarioId: "base",
        documentRole: "standalone",
        chapterId: "protectingYourFamily",
      });
      expect(res.status).toBe(400);
      expect(mocks.loadStoryContext).toHaveBeenCalled();
      expect(mocks.generateChapter).not.toHaveBeenCalled();
      expect(mocks.upsertGeneratedChapter).not.toHaveBeenCalled();
    });

    // Kills: an audit row that says "a story was generated" for a run that wrote
    // one paragraph. The row is the record of the spend; the two shapes of this
    // route differ by a factor of fourteen.
    it("names the single chapter in the audit row", async () => {
      await post({
        scenarioId: "base",
        documentRole: "standalone",
        chapterId: "whatYouHave",
        force: true,
      });
      expect(mocks.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ chapterId: "whatYouHave", chapters: 1 }),
        }),
      );
    });

    /**
     * Kills: checking the ceiling AFTER the load. The story context runs two
     * projections and a Monte Carlo read — 23.2s cold — and a request that is
     * going to be refused must not pay for them.
     */
    it("refuses a firm over its ceiling before it rebuilds the plan", async () => {
      mocks.checkPlanStoryRateLimit.mockResolvedValue({
        allowed: false,
        reason: "exceeded",
        remaining: 0,
        reset: Date.now() + 45_000,
      });
      const res = await post({ scenarioId: "base", documentRole: "standalone" });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("45");
      expect(mocks.loadStoryContext).not.toHaveBeenCalled();
      expect(mocks.generateChapter).not.toHaveBeenCalled();
    });

    /**
     * Kills: any "if the limiter cannot answer, let it through" reading. The
     * standing rule for this repo is that rate limiting FAILS CLOSED — a missing
     * Upstash variable must not be the cheapest way to spend model budget.
     */
    it("refuses rather than running uncapped when the limiter cannot answer", async () => {
      mocks.checkPlanStoryRateLimit.mockResolvedValue({ allowed: false, reason: "unconfigured" });
      const res = await post({ scenarioId: "base", documentRole: "standalone" });
      expect(res.status).toBe(503);
      expect(mocks.generateChapter).not.toHaveBeenCalled();
    });

    // Kills: keying on the client. One advisor cycling ten households is the
    // shape this exists to stop, and a per-client key lets every bit of it
    // through.
    it("keys the ceiling on the firm, not the client", async () => {
      await post({ scenarioId: "base", documentRole: "standalone" });
      expect(mocks.checkPlanStoryRateLimit).toHaveBeenCalledWith("firm_1", "run");
    });

    // Kills: one bucket for both. A budget wide enough for an advisor rewriting
    // paragraphs one at a time is fourteen whole runs a minute; one tight enough
    // for whole runs stops the third fix of a sentence.
    it("draws one chapter from a different bucket than a whole run", async () => {
      await post({
        scenarioId: "base",
        documentRole: "standalone",
        chapterId: "whatYouHave",
        force: true,
      });
      expect(mocks.checkPlanStoryRateLimit).toHaveBeenCalledWith("firm_1", "chapter");
    });

    // Kills: exempting the forced path — which is the only path the panel's own
    // buttons take past the cache, and so the only one that always spends.
    it("counts a forced whole run against the ceiling", async () => {
      await post({ scenarioId: "base", documentRole: "standalone", force: true });
      expect(mocks.checkPlanStoryRateLimit).toHaveBeenCalledWith("firm_1", "run");
    });
  });
});
