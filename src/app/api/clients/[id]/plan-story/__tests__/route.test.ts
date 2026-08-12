import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * What these tests can and cannot see.
 *
 * The repo's WRITERS, the story loader and the generator are mocked — they are
 * IO or an LLM call, and Tasks 8/10/11 own their behaviour. What is real here
 * is everything the routes themselves decide: the access gates, the chapter
 * projection, `resolveChapterText`'s precedence, the `requiresProposal` filter
 * (read from the real registry), the scenario-id contract, and the audit
 * payload the route assembles (`crossFirmAuditMeta` is deliberately NOT mocked,
 * so the metadata is really built).
 *
 * `recordAudit` itself is a spy, so these tests prove the SHAPE the route
 * passes, never that a row lands.
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
  generateChapter: vi.fn(),
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

vi.mock("@/lib/db-helpers", () => ({
  requireOrgId: mocks.requireOrgId,
  requireOrgAndUser: mocks.requireOrgAndUser,
}));

vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: mocks.verifyClientAccess,
  requireClientEditAccess: mocks.requireClientEditAccess,
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: mocks.requireActiveSubscriptionForFirm,
  authErrorResponse: vi.fn(() => null),
}));

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

vi.mock("@/lib/presentations/story/generate", () => ({
  generateChapter: mocks.generateChapter,
}));

import { GET } from "../route";
import { POST } from "../generate/route";
import { PATCH } from "../[chapterId]/route";

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
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.listStoryChapters.mockResolvedValue([]);
  mocks.updateChapterText.mockResolvedValue(undefined);
  mocks.markChapterReviewed.mockResolvedValue(undefined);
  mocks.upsertGeneratedChapter.mockResolvedValue(undefined);
  mocks.loadStoryContext.mockResolvedValue({ hasProposal: false, facts: [], strategies: [] });
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
  it("returns one entry per chapter, including never-generated ones", async () => {
    const res = await GET(req("http://x/?scenarioId=base"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, "base");
    expect(body.chapters).toHaveLength(3);
    expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual([
      "planInOnePage",
      "whatYouHave",
      "whatWeRecommend",
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

  // Kills: hardcoding "base" instead of reading the query string.
  it("scopes the listing to the requested scenario", async () => {
    await GET(req(`http://x/?scenarioId=${SCENARIO_ID}`), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, SCENARIO_ID);
  });
});

describe("PATCH /api/clients/[id]/plan-story/[chapterId]", () => {
  const patch = (body: unknown, chapterId = "planInOnePage") =>
    PATCH(jsonReq(body), { params: Promise.resolve({ id: CLIENT_ID, chapterId }) });

  // Kills: removing `isChapterId`. Both writers are upserts, so an unguarded
  // chapterId persists a junk row rather than harmlessly matching nothing.
  it("rejects an unknown chapter id without writing", async () => {
    const res = await patch({ scenarioId: "base", editedText: "hi" }, "nope");
    expect(res.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });

  // Kills: dropping any of the four write args, or any required audit field
  // (`firmId` is required by recordAudit and easy to omit).
  it("saves an edit and records audit", async () => {
    const res = await patch({ scenarioId: "base", editedText: "My words." });
    expect(res.status).toBe(200);
    expect(mocks.updateChapterText).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      scenarioId: "base",
      chapterId: "planInOnePage",
      editedText: "My words.",
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: "plan_story.chapter_edited",
      resourceType: "plan_story_chapter",
      resourceId: "planInOnePage",
      clientId: CLIENT_ID,
      firmId: "firm_1",
      metadata: { scenarioId: "base" },
    });
  });

  // Kills: collapsing an empty edit into "no edit". Clearing the box is how an
  // advisor drops their version and lets the model's words render again; read
  // as absent, it is answered 400 and the advisor's version stays put.
  it("treats an empty edit as clearing the advisor's version", async () => {
    const res = await patch({ scenarioId: "base", editedText: "" });
    expect(res.status).toBe(200);
    expect(mocks.updateChapterText).toHaveBeenCalledWith(
      expect.objectContaining({ editedText: "" }),
    );
  });

  // Kills: stamping the org id (or nothing) as the reviewer instead of the
  // acting user — the flag's whole point is who stands behind the words.
  it("marks a chapter reviewed as the acting user", async () => {
    const res = await patch({ scenarioId: "base", reviewed: true });
    expect(res.status).toBe(200);
    expect(mocks.markChapterReviewed).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      scenarioId: "base",
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
    const res = await patch({ scenarioId: "base" });
    expect(res.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
    expect(mocks.markChapterReviewed).not.toHaveBeenCalled();
  });

  // Kills: hand-rolling `request.json()` instead of validating. An unknown key
  // is a caller sending a field this route does not implement — answering 200
  // tells them it landed. A null body would be a 500 (`null.editedText`).
  it("rejects a body the schema does not accept", async () => {
    const unknownKey = await patch({ scenarioId: "base", editedText: "hi", bogus: 1 });
    expect(unknownKey.status).toBe(400);
    const nullBody = await patch(null);
    expect(nullBody.status).toBe(400);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });

  // Kills: taking `body.scenarioId` on trust. Every distinct junk string would
  // otherwise create its own row, invisible to GET and never cleaned up.
  it("refuses a scenario the client does not own", async () => {
    mocks.scenarioRows = [];
    const res = await patch({ scenarioId: SCENARIO_ID, editedText: "hi" });
    expect(res.status).toBe(404);
    expect(mocks.updateChapterText).not.toHaveBeenCalled();
  });

  // Kills: a guard that rejects everything but "base", which would make a
  // per-scenario story unwritable.
  it("accepts a scenario the client owns", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    const res = await patch({ scenarioId: SCENARIO_ID, editedText: "hi" });
    expect(res.status).toBe(200);
    expect(mocks.updateChapterText).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: SCENARIO_ID }),
    );
  });

  // Kills: letting a non-uuid reach Postgres, where `scenarios.id` is a uuid
  // column and the cast raises 22P02 — a 500 instead of a rejection.
  it("rejects a malformed scenarioId before it reaches the database", async () => {
    const res = await patch({ scenarioId: "not-a-uuid", editedText: "hi" });
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
    const res = await post({ scenarioId: "base" });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual([
      "planInOnePage",
      "whatYouHave",
    ]);
    expect(mocks.upsertGeneratedChapter).toHaveBeenCalledTimes(2);
    expect(mocks.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, firmId: "firm_1", proposedRef: null }),
    );
  });

  // Kills: inverting that filter, and confirms the proposed ref reaches the
  // loader rather than being flattened to base.
  it("generates every chapter for a proposal, and stores each one", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    mocks.loadStoryContext.mockResolvedValue({ hasProposal: true, facts: [], strategies: [] });
    const res = await post({ scenarioId: SCENARIO_ID });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chapters).toHaveLength(3);
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
        metadata: expect.objectContaining({ scenarioId: SCENARIO_ID, chapters: 3 }),
      }),
    );
  });

  // Kills: letting a `snap:` ref through to the loader, which degrades it to a
  // proposal with zero strategies and no proposed confidence.
  it("refuses a snapshot ref, and says so", async () => {
    const res = await post({ scenarioId: "snap:abc" });
    expect(res.status).toBe(400);
    // Named, not lumped in with "invalid id": a snapshot is a well-formed ref
    // the feature declines, and the advisor picked it from a real picker.
    expect((await res.json()).error).toMatch(/snapshot/i);
    expect(mocks.loadStoryContext).not.toHaveBeenCalled();
    expect(mocks.upsertGeneratedChapter).not.toHaveBeenCalled();
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
    const res = await post({ scenarioId: "base" });
    const body = await res.json();
    expect(body.chapters[0]).toMatchObject({
      aiSuppressed: true,
      error: "The writing assistant was unavailable.",
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          suppressed: ["planInOnePage", "whatYouHave"],
        }),
      }),
    );
  });
});
