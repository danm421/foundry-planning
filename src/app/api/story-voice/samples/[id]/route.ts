import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import {
  requireActiveSubscriptionForFirm,
  requireOrgAdminOrOwner,
  authErrorResponse,
} from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { storyVoiceSamplePatchSchema } from "@/lib/schemas/story-voice";
import {
  setVoiceSampleEnabled,
  deleteVoiceSample,
  loadVoiceSampleOwner,
  FIRM_DEFAULT_ADVISOR,
} from "@/lib/presentations/story/voice/repo";

export const dynamic = "force-dynamic";

/**
 * Guard before the query — a malformed uuid would throw at the pg layer and 500
 * a request that is simply naming a sample that cannot exist. 404, not 400, and
 * with the handlers' own message: it is the same answer a well-formed id from
 * another firm gets, which is what keeps the two indistinguishable. Matches the
 * three sibling `[id]` routes (`observations/draft-runs`, `meeting-prep/runs`,
 * `intake/documents`), all of which 404 here.
 */
function malformed(id: string): boolean {
  return !z.string().uuid().safeParse(id).success;
}

/**
 * May this caller change this sample? Own row yes; the firm's shared row only as
 * an admin; anything else no.
 *
 * ⚠️ `firmId` alone is NOT enough here, and both mutators scope on `firmId + id`
 * only (`voice/repo.ts`). That is a cross-firm floor. Within one firm it left a
 * real gap: creating a firm-wide sample is admin-only — `POST
 * /api/story-voice/samples` calls `requireOrgAdminOrOwner` when `firmDefault` is
 * set — while deleting one was open to every member, so the row an admin alone
 * could create, anyone could destroy. The same predicate also closes the
 * narrower case of a member switching off a COLLEAGUE's personal sample by
 * naming its id.
 *
 * The admin check is a caught `requireOrgAdminOrOwner` rather than a second
 * reading of the role string: `authz.ts` owns what "admin" means, and this file
 * having its own copy is how the two come to disagree. What is NOT reused is its
 * status — `authErrorResponse` maps `ForbiddenError` to 403 (`authz.ts:275`), and
 * a 403 here separates "this id exists and you may not touch it" from "no such
 * id". Every other way this file says no to an ID is a 404 for exactly that
 * reason — a malformed uuid, and a write that matched no row — so this is too,
 * and the caught error is discarded rather than rethrown. (The 400 from
 * `parseBody` is about the request BODY, not about which id was named.)
 */
async function mayMutate(firmId: string, userId: string, id: string): Promise<boolean> {
  const owner = await loadVoiceSampleOwner({ firmId, id });
  if (owner === null) return false;
  if (owner === userId) return true;
  if (owner !== FIRM_DEFAULT_ADVISOR) return false;
  try {
    await requireOrgAdminOrOwner();
    return true;
  } catch {
    // Fails closed on anything the gate throws, including a session that went
    // away between `requireOrgAndUser` and here.
    return false;
  }
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Sample not found" }, { status: 404 });
}

/**
 * Switch one sample on or off.
 *
 * Two refusals, both 404 and both indistinguishable from each other by design:
 * `mayMutate` answers no for a row this caller may not touch, and
 * `setVoiceSampleEnabled` scopes on `firmId` and reports whether a row MATCHED
 * for one that is gone by the time the write lands. `DELETE` below is built the
 * same way.
 *
 * The stored text is not editable: `storyVoiceSamplePatchSchema` is strict and
 * has no `text` field, because POST is where `scrubSample` runs.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);
    const { id } = await params;
    if (malformed(id)) return notFound();

    const parsed = await parseBody(storyVoiceSamplePatchSchema, request);
    if (!parsed.ok) return parsed.response;
    const { enabled } = parsed.data;

    if (!(await mayMutate(firmId, userId, id))) return notFound();

    const updated = await setVoiceSampleEnabled({ firmId, id, enabled });
    if (!updated) return notFound();

    await recordAudit({
      action: "story_voice.sample_enabled",
      resourceType: "story_voice_sample",
      resourceId: id,
      firmId,
      // Which direction, because the action covers both.
      metadata: { enabled },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/story-voice/samples/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);
    const { id } = await params;
    if (malformed(id)) return notFound();

    if (!(await mayMutate(firmId, userId, id))) return notFound();

    const deleted = await deleteVoiceSample({ firmId, id });
    if (!deleted) return notFound();

    await recordAudit({
      action: "story_voice.sample_deleted",
      resourceType: "story_voice_sample",
      resourceId: id,
      firmId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/story-voice/samples/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
