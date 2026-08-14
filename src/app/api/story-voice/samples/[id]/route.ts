import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { storyVoiceSamplePatchSchema } from "@/lib/schemas/story-voice";
import { setVoiceSampleEnabled, deleteVoiceSample } from "@/lib/presentations/story/voice/repo";

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
 * Switch one sample on or off.
 *
 * `setVoiceSampleEnabled` scopes on `firmId` and reports whether a row MATCHED,
 * so an id belonging to another firm comes back as a 404 without this handler
 * ever reading the row — no branch here can leak that it exists. `DELETE` below
 * is built the same way.
 *
 * The stored text is not editable: `storyVoiceSamplePatchSchema` is strict and
 * has no `text` field, because POST is where `scrubSample` runs.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId: firmId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);
    const { id } = await params;
    if (malformed(id)) return NextResponse.json({ error: "Sample not found" }, { status: 404 });

    const parsed = await parseBody(storyVoiceSamplePatchSchema, request);
    if (!parsed.ok) return parsed.response;
    const { enabled } = parsed.data;

    const updated = await setVoiceSampleEnabled({ firmId, id, enabled });
    if (!updated) return NextResponse.json({ error: "Sample not found" }, { status: 404 });

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
    const { orgId: firmId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);
    const { id } = await params;
    if (malformed(id)) return NextResponse.json({ error: "Sample not found" }, { status: 404 });

    const deleted = await deleteVoiceSample({ firmId, id });
    if (!deleted) return NextResponse.json({ error: "Sample not found" }, { status: 404 });

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
