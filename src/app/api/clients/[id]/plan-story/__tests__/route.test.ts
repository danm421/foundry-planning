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

vi.mock("@/lib/presentations/story/generate", () => ({
  generateChapter: mocks.generateChapter,
}));

import { ForbiddenError } from "@/lib/authz";
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
  it("returns one entry per chapter, including never-generated ones", async () => {
    const res = await GET(req("http://x/?scenarioId=base"), {
      params: Promise.resolve({ id: CLIENT_ID }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mocks.listStoryChapters).toHaveBeenCalledWith(CLIENT_ID, "base", "standalone");
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
    expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual([
      "planInOnePage",
      "whatYouHave",
    ]);
    expect(mocks.upsertGeneratedChapter).toHaveBeenCalledTimes(2);
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
    expect(body.chapters.map((c: { chapterId: string }) => c.chapterId)).toEqual([
      "planInOnePage",
      "whatYouHave",
    ]);
    expect(mocks.generateChapter).not.toHaveBeenCalledWith(
      expect.objectContaining({ chapterId: "whatWeRecommend" }),
    );
    expect(mocks.upsertGeneratedChapter).toHaveBeenCalledTimes(2);
  });

  // Kills: inverting that filter, and confirms the proposed ref reaches the
  // loader rather than being flattened to base.
  it("generates every chapter for a proposal, and stores each one", async () => {
    mocks.scenarioRows = [{ id: SCENARIO_ID }];
    // A proposal with a change in it — which is now what "a proposal" means to
    // this route, per the test above.
    mocks.loadStoryContext.mockResolvedValue({
      hasProposal: true,
      facts: [],
      strategies: [{ name: "Convert to Roth", rows: [] }],
    });
    const res = await post({ scenarioId: SCENARIO_ID, documentRole: "standalone" });
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
          suppressed: ["planInOnePage", "whatYouHave"],
        }),
      }),
    );
  });
});
