import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/**
 * What these tests can and cannot see.
 *
 * The repo is mocked — it is IO, and Task 6 owns its behaviour. The gates are
 * spies too, so what is proved about them is that each route CALLS them, with
 * WHICH arguments, and before which write — never that a gate itself decides
 * correctly.
 *
 * ⚠️ `scrubSample` is NOT mocked, on purpose, and neither is the schema module.
 * The one property this whole surface exists to hold is that no unscrubbed text
 * reaches `story_voice_samples`, and a mocked scrubber proves only that the
 * route called something. The scrub assertions below compare the stored string
 * to the EXACT expected output, and the empty-household case is the control:
 * same input, no source client, and "Cooper" comes back through untouched. That
 * pair is what separates "the scrubber ran" from "the input happened not to
 * contain the name".
 *
 * `loadStoryHousehold` IS mocked — it is two queries, and the interesting thing
 * about it here is WHICH firm id the route scopes it to.
 */
const mocks = vi.hoisted(() => ({
  requireOrgAndUser: vi.fn(),
  requireActiveSubscriptionForFirm: vi.fn(),
  requireOrgAdminOrOwner: vi.fn(),
  verifyClientAccess: vi.fn(),
  recordAudit: vi.fn(),
  loadStoryHousehold: vi.fn(),
  loadVoiceProfile: vi.fn(),
  upsertVoiceProfile: vi.fn(),
  insertVoiceSample: vi.fn(),
  listVoiceSamples: vi.fn(),
  setVoiceSampleEnabled: vi.fn(),
  deleteVoiceSample: vi.fn(),
  loadVoiceSampleOwner: vi.fn(),
}));

// Only the session reader is replaced. `UnauthorizedError` stays real because
// `authErrorResponse` tests thrown errors with `instanceof`.
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return { ...actual, requireOrgAndUser: mocks.requireOrgAndUser };
});

// Same reason: `ForbiddenError` and `authErrorResponse` are the real ones, so a
// 403 below is the mapping every sibling route gets, not one this file invented.
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {
    ...actual,
    requireActiveSubscriptionForFirm: mocks.requireActiveSubscriptionForFirm,
    requireOrgAdminOrOwner: mocks.requireOrgAdminOrOwner,
  };
});

vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: mocks.verifyClientAccess }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));

vi.mock("@/lib/presentations/story/load-context", () => ({
  loadStoryHousehold: mocks.loadStoryHousehold,
}));

// `FIRM_DEFAULT_ADVISOR` keeps its real value — "" is the firm-default advisor
// id everywhere else, and a stand-in here would hide a route writing the wrong
// owner onto a firm-wide row.
vi.mock("@/lib/presentations/story/voice/repo", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/presentations/story/voice/repo")>(
      "@/lib/presentations/story/voice/repo",
    );
  return {
    FIRM_DEFAULT_ADVISOR: actual.FIRM_DEFAULT_ADVISOR,
    loadVoiceProfile: mocks.loadVoiceProfile,
    upsertVoiceProfile: mocks.upsertVoiceProfile,
    insertVoiceSample: mocks.insertVoiceSample,
    listVoiceSamples: mocks.listVoiceSamples,
    setVoiceSampleEnabled: mocks.setVoiceSampleEnabled,
    deleteVoiceSample: mocks.deleteVoiceSample,
    loadVoiceSampleOwner: mocks.loadVoiceSampleOwner,
  };
});

import { GET as PROFILE_GET, PUT as PROFILE_PUT } from "../route";
import { GET as SAMPLES_GET, POST } from "../samples/route";
import { PATCH, DELETE } from "../samples/[id]/route";
import { ForbiddenError } from "@/lib/authz";

const FIRM = "org_firm";
const USER = "user_advisor";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";
const SAMPLE = "33333333-3333-4333-8333-333333333333";

/** The Cooper household as `load-context.ts` composes every one of them. */
const COOPER = { firstNames: "Cooper and Susan", householdName: "the Sample household" };

/** One sentence carrying BOTH things the scrubber removes — a given name and a
 *  figure — so a single stored string can show each pass ran or did not. */
const RAW = "Cooper, your plan holds. You own $2.4M.";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function params(id: string) {
  return Promise.resolve({ id });
}
/** What `insertVoiceSample` was handed on the first (and only) call. */
function stored(): { text: string; advisorUserId: string; sourceClientId: string | null } {
  return mocks.insertVoiceSample.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgAndUser.mockResolvedValue({ orgId: FIRM, userId: USER });
  mocks.requireActiveSubscriptionForFirm.mockResolvedValue(undefined);
  mocks.requireOrgAdminOrOwner.mockResolvedValue(undefined);
  mocks.verifyClientAccess.mockResolvedValue({
    ok: true,
    permission: "edit",
    firmId: FIRM,
    access: "own",
  });
  mocks.loadStoryHousehold.mockResolvedValue(COOPER);
  mocks.insertVoiceSample.mockResolvedValue(SAMPLE);
  mocks.listVoiceSamples.mockResolvedValue([]);
  mocks.setVoiceSampleEnabled.mockResolvedValue(true);
  mocks.deleteVoiceSample.mockResolvedValue(true);
  // The common case: the caller owns the row they are naming.
  mocks.loadVoiceSampleOwner.mockResolvedValue(USER);
  mocks.loadVoiceProfile.mockResolvedValue(null);
});

describe("POST /api/story-voice/samples", () => {
  it("scrubs before storing — a client's name never reaches the table", async () => {
    const res = await POST(req({ text: RAW, sourceClientId: CLIENT }));
    expect(res.status).toBe(200);
    // The WHOLE string, not an absence. "not.toContain('Cooper')" passes just as
    // well when the scrubber is a no-op on an input that never held the name;
    // the stand-ins are what prove each pass actually fired.
    expect(stored().text).toBe("They, your plan holds. You own that amount.");
  });

  it("leaves the name in when there is no source client — the CONTROL for the test above", async () => {
    // Same input, no household to scrub against. The name survives (nothing knows
    // it is a name) and the figure still does not (a figure is a figure in any
    // household). So the previous test's missing "Cooper" is the household pass
    // doing its job, not the input being harmless.
    const res = await POST(req({ text: RAW }));
    expect(res.status).toBe(200);
    expect(mocks.loadStoryHousehold).not.toHaveBeenCalled();
    expect(stored().text).toBe("Cooper, your plan holds. You own that amount.");
  });

  it("hands back the scrubbed text, so the advisor reads what the model will", async () => {
    const res = await POST(req({ text: RAW, sourceClientId: CLIENT }));
    expect(await res.json()).toEqual({
      id: SAMPLE,
      text: "They, your plan holds. You own that amount.",
    });
  });

  it("scrubs against the CLIENT's firm, not the caller's — a shared client is harvestable at all", async () => {
    // A cross-org shared client belongs to another firm, and `loadStoryHousehold`
    // is firm-scoped. Hand it the caller's org and it finds no row and THROWS —
    // so every harvest from a shared client would 500. Closed, but broken.
    mocks.verifyClientAccess.mockResolvedValue({
      ok: true,
      permission: "edit",
      firmId: "org_other_firm",
      access: "shared",
    });
    await POST(req({ text: RAW, sourceClientId: CLIENT }));
    expect(mocks.loadStoryHousehold).toHaveBeenCalledWith(CLIENT, "org_other_firm");
    // The row lands in the CALLER's firm while the prose came from another's, so
    // the audit says who really did it.
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ crossFirmActor: true, actorFirmId: FIRM }),
      }),
    );
  });

  it("stores nothing when the household cannot be resolved", async () => {
    // Fails CLOSED. Without the names there is nothing to scrub against, and a
    // sample stored anyway is the leak this route exists to prevent.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.loadStoryHousehold.mockRejectedValue(new Error("no primary contact"));
    const res = await POST(req({ text: RAW, sourceClientId: CLIENT }));
    expect(res.status).toBe(500);
    expect(mocks.insertVoiceSample).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("stores a sample disabled, so nothing an advisor typed is sent until they say so", async () => {
    await POST(req({ text: RAW, sourceClientId: CLIENT }));
    // `insertVoiceSample` hardcodes enabled: false — this pins that it is not a
    // caller-supplied field.
    expect(stored()).not.toHaveProperty("enabled");
  });

  it("refuses a sample naming a client this caller cannot see", async () => {
    mocks.verifyClientAccess.mockResolvedValue({ ok: false });
    const res = await POST(req({ text: RAW, sourceClientId: OTHER_CLIENT }));
    expect(res.status).toBe(404);
    expect(mocks.insertVoiceSample).not.toHaveBeenCalled();
  });

  it("requires an active subscription", async () => {
    mocks.requireActiveSubscriptionForFirm.mockRejectedValue(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(req({ text: RAW }));
    // 403, not 402 — `authErrorResponse` is shared by every route in the app and
    // maps `ForbiddenError` this way; the app has no 402 anywhere.
    expect(res.status).toBe(403);
    expect(mocks.insertVoiceSample).not.toHaveBeenCalled();
  });

  it("audits the harvest against the client it came from", async () => {
    await POST(req({ text: RAW, sourceChapterId: "whatWeRecommend", sourceClientId: CLIENT }));
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "story_voice.sample_added",
        resourceType: "story_voice_sample",
        resourceId: SAMPLE,
        clientId: CLIENT,
        firmId: FIRM,
        // Own-firm: `crossFirmAuditMeta` returns the base unchanged, so no
        // cross-firm stamp rides along on the ordinary case.
        metadata: { sourceChapterId: "whatWeRecommend", firmDefault: false },
      }),
    );
  });

  it("files a firm-default sample under the firm, and only for an admin", async () => {
    await POST(req({ text: RAW, firmDefault: true }));
    expect(stored().advisorUserId).toBe("");
    expect(mocks.requireOrgAdminOrOwner).toHaveBeenCalled();
  });

  it("files an ordinary sample under the advisor, without asking for a role", async () => {
    await POST(req({ text: RAW }));
    expect(stored().advisorUserId).toBe(USER);
    expect(mocks.requireOrgAdminOrOwner).not.toHaveBeenCalled();
  });

  it("refuses a firm-default sample from a member — a firm sample reaches every colleague's prompt", async () => {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(
      new ForbiddenError("Organization admin role required"),
    );
    const res = await POST(req({ text: RAW, firmDefault: true }));
    expect(res.status).toBe(403);
    expect(mocks.insertVoiceSample).not.toHaveBeenCalled();
  });

  it("rejects a chapter id this build does not have", async () => {
    const res = await POST(req({ text: RAW, sourceChapterId: "nope" }));
    expect(res.status).toBe(400);
    expect(mocks.insertVoiceSample).not.toHaveBeenCalled();
  });

  it("accepts a real chapter id", async () => {
    await POST(req({ text: RAW, sourceChapterId: "planInOnePage" }));
    expect(mocks.insertVoiceSample).toHaveBeenCalledWith(
      expect.objectContaining({ sourceChapterId: "planInOnePage" }),
    );
  });

  it("rejects text past the prompt budget rather than truncating it", async () => {
    // 2,000 is well under the 20,000 an advisor may write into a chapter, so a
    // harvest of a long edit is REFUSED, not silently shortened. The panel has to
    // say so; nothing here can.
    const res = await POST(req({ text: "a".repeat(2001) }));
    expect(res.status).toBe(400);
    expect(mocks.insertVoiceSample).not.toHaveBeenCalled();
  });

  it("accepts a sample right up to the bound", async () => {
    // The other side of the cap, so an off-by-one that moved it would show.
    const res = await POST(req({ text: "a".repeat(2000) }));
    expect(res.status).toBe(200);
  });

  it("rejects a sample too short to be a sample of anything", async () => {
    const res = await POST(req({ text: "ok" }));
    expect(res.status).toBe(400);
    expect(mocks.insertVoiceSample).not.toHaveBeenCalled();
  });
});

describe("GET /api/story-voice/samples", () => {
  it("lists this advisor's samples and the firm's, scrubbed text and all", async () => {
    mocks.listVoiceSamples.mockResolvedValue([
      {
        id: SAMPLE,
        firmId: FIRM,
        advisorUserId: "",
        text: "They own that amount.",
        sourceChapterId: "whatWeRecommend",
        sourceClientId: null,
        enabled: true,
        createdBy: USER,
        createdAt: new Date("2026-08-14T00:00:00Z"),
        updatedAt: new Date("2026-08-14T00:00:00Z"),
      },
    ]);
    const res = await SAMPLES_GET();
    expect(mocks.listVoiceSamples).toHaveBeenCalledWith(FIRM, USER);
    expect(await res.json()).toEqual({
      samples: [
        {
          id: SAMPLE,
          text: "They own that amount.",
          sourceChapterId: "whatWeRecommend",
          enabled: true,
          firmDefault: true,
        },
      ],
    });
  });
});

describe("PATCH /api/story-voice/samples/[id]", () => {
  it("404s an id belonging to another firm rather than reporting success", async () => {
    mocks.setVoiceSampleEnabled.mockResolvedValue(false);
    const res = await PATCH(req({ enabled: true }), { params: params(SAMPLE) });
    expect(res.status).toBe(404);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("audits the enable, because it changes what is sent to the model", async () => {
    await PATCH(req({ enabled: true }), { params: params(SAMPLE) });
    expect(mocks.setVoiceSampleEnabled).toHaveBeenCalledWith({
      firmId: FIRM,
      id: SAMPLE,
      enabled: true,
    });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "story_voice.sample_enabled",
        resourceId: SAMPLE,
        metadata: { enabled: true },
      }),
    );
  });

  it("records the OFF direction too, under the same action and its own metadata", async () => {
    await PATCH(req({ enabled: false }), { params: params(SAMPLE) });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "story_voice.sample_enabled",
        metadata: { enabled: false },
      }),
    );
  });

  it("404s a malformed id instead of letting it reach Postgres", async () => {
    const res = await PATCH(req({ enabled: true }), { params: params("not-a-uuid") });
    expect(res.status).toBe(404);
    expect(mocks.setVoiceSampleEnabled).not.toHaveBeenCalled();
  });

  it("refuses an attempt to rewrite the stored text", async () => {
    // `text` is not a PATCH field: POST is the only writer, because POST is
    // where `scrubSample` runs. `.strict()` makes that a 400 rather than a
    // silent no-op the advisor reads as saved.
    const res = await PATCH(req({ enabled: true, text: RAW }), { params: params(SAMPLE) });
    expect(res.status).toBe(400);
    expect(mocks.setVoiceSampleEnabled).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/story-voice/samples/[id]", () => {
  it("404s an id belonging to another firm", async () => {
    mocks.deleteVoiceSample.mockResolvedValue(false);
    const res = await DELETE(req({}), { params: params(SAMPLE) });
    expect(res.status).toBe(404);
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("404s a malformed id instead of letting it reach Postgres", async () => {
    const res = await DELETE(req({}), { params: params("not-a-uuid") });
    expect(res.status).toBe(404);
    expect(mocks.deleteVoiceSample).not.toHaveBeenCalled();
  });

  it("audits the delete", async () => {
    const res = await DELETE(req({}), { params: params(SAMPLE) });
    expect(res.status).toBe(200);
    expect(mocks.deleteVoiceSample).toHaveBeenCalledWith({ firmId: FIRM, id: SAMPLE });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "story_voice.sample_deleted", resourceId: SAMPLE }),
    );
  });
});

/**
 * Who may change a sample that already exists.
 *
 * ⚠️ `firmId` alone is NOT the rule, and this is the gap these tests were written
 * for. Creating a firm-wide sample is admin-only — `POST` calls
 * `requireOrgAdminOrOwner` when `firmDefault` is set — while the two mutators
 * scope on `firmId + id` and nothing else, so the exemplar only an admin could
 * create, any member could permanently delete. The rule is: your own row, or the
 * firm's row if you are an admin; anything else is a 404.
 *
 * 404 and not 403, on purpose. A 403 would separate "this id exists and you may
 * not touch it" from "no such id", which is exactly the distinction every other
 * refusal in that file is built to hide.
 */
describe("who may change a sample", () => {
  const COLLEAGUE = "user_colleague";

  /** A member, not an admin — the gate is the real one, so this is how a
   *  non-admin session is expressed. */
  function asMember() {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(new ForbiddenError("nope"));
  }

  it.each([
    ["PATCH", () => PATCH(req({ enabled: true }), { params: params(SAMPLE) })],
    ["DELETE", () => DELETE(req({}), { params: params(SAMPLE) })],
  ])("%s 404s a member acting on the firm's shared row", async (_m, call) => {
    mocks.loadVoiceSampleOwner.mockResolvedValue(""); // FIRM_DEFAULT_ADVISOR
    asMember();
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.setVoiceSampleEnabled).not.toHaveBeenCalled();
    expect(mocks.deleteVoiceSample).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["PATCH", () => PATCH(req({ enabled: true }), { params: params(SAMPLE) })],
    ["DELETE", () => DELETE(req({}), { params: params(SAMPLE) })],
  ])("%s lets an ADMIN act on the firm's shared row", async (_m, call) => {
    mocks.loadVoiceSampleOwner.mockResolvedValue("");
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.recordAudit).toHaveBeenCalled();
  });

  it.each([
    ["PATCH", () => PATCH(req({ enabled: true }), { params: params(SAMPLE) })],
    ["DELETE", () => DELETE(req({}), { params: params(SAMPLE) })],
  ])("%s 404s a colleague's personal row, admin or not", async (_m, call) => {
    // The narrower half of the same hole: naming another member's own sample by
    // its id. Admin does NOT open this — the rule grants the firm's row, not
    // everyone's.
    mocks.loadVoiceSampleOwner.mockResolvedValue(COLLEAGUE);
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.setVoiceSampleEnabled).not.toHaveBeenCalled();
    expect(mocks.deleteVoiceSample).not.toHaveBeenCalled();
  });

  it.each([
    ["PATCH", () => PATCH(req({ enabled: true }), { params: params(SAMPLE) })],
    ["DELETE", () => DELETE(req({}), { params: params(SAMPLE) })],
  ])("%s 404s an id this firm does not have, without a write", async (_m, call) => {
    mocks.loadVoiceSampleOwner.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.setVoiceSampleEnabled).not.toHaveBeenCalled();
    expect(mocks.deleteVoiceSample).not.toHaveBeenCalled();
  });

  it("scopes the ownership read to the CALLER's firm", async () => {
    await DELETE(req({}), { params: params(SAMPLE) });
    expect(mocks.loadVoiceSampleOwner).toHaveBeenCalledWith({ firmId: FIRM, id: SAMPLE });
  });

  it("does not read ownership for a malformed id", async () => {
    await DELETE(req({}), { params: params("not-a-uuid") });
    expect(mocks.loadVoiceSampleOwner).not.toHaveBeenCalled();
  });
});

describe("GET /api/story-voice", () => {
  it("resolves the profile for the CALLING advisor", async () => {
    mocks.loadVoiceProfile.mockResolvedValue({
      firmId: FIRM,
      advisorUserId: "",
      styleNote: "Short sentences.",
    });
    const res = await PROFILE_GET();
    expect(mocks.loadVoiceProfile).toHaveBeenCalledWith(FIRM, USER);
    // `advisorUserId` rides along so the panel can say the note is the firm's,
    // not this advisor's own.
    expect(await res.json()).toEqual({
      profile: { advisorUserId: "", styleNote: "Short sentences." },
    });
  });

  it("reports no profile as null rather than an empty note", async () => {
    const res = await PROFILE_GET();
    expect(await res.json()).toEqual({ profile: null });
  });
});

describe("PUT /api/story-voice", () => {
  it("writes the calling advisor's own row", async () => {
    const res = await PROFILE_PUT(req({ styleNote: "Plain words." }));
    expect(res.status).toBe(200);
    expect(mocks.upsertVoiceProfile).toHaveBeenCalledWith({
      firmId: FIRM,
      advisorUserId: USER,
      styleNote: "Plain words.",
      updatedBy: USER,
    });
    expect(mocks.requireOrgAdminOrOwner).not.toHaveBeenCalled();
  });

  it("writes the firm row only after re-checking the role", async () => {
    await PROFILE_PUT(req({ styleNote: "House style.", firmDefault: true }));
    expect(mocks.requireOrgAdminOrOwner).toHaveBeenCalled();
    expect(mocks.upsertVoiceProfile).toHaveBeenCalledWith(
      expect.objectContaining({ advisorUserId: "" }),
    );
  });

  it("refuses a firm-default write from a member", async () => {
    mocks.requireOrgAdminOrOwner.mockRejectedValue(
      new ForbiddenError("Organization admin role required"),
    );
    const res = await PROFILE_PUT(req({ styleNote: "House style.", firmDefault: true }));
    expect(res.status).toBe(403);
    expect(mocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });

  it("audits the write", async () => {
    await PROFILE_PUT(req({ styleNote: "Plain words." }));
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "story_voice.profile_updated",
        resourceType: "story_voice_profile",
        firmId: FIRM,
      }),
    );
  });

  it("rejects a style note longer than the same bound the samples carry", async () => {
    const res = await PROFILE_PUT(req({ styleNote: "x".repeat(2001) }));
    expect(res.status).toBe(400);
    expect(mocks.upsertVoiceProfile).not.toHaveBeenCalled();
  });
});
