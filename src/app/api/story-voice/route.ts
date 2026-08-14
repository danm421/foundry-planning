import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import {
  requireActiveSubscriptionForFirm,
  requireOrgAdminOrOwner,
  authErrorResponse,
} from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { storyVoiceProfilePutSchema } from "@/lib/schemas/story-voice";
import {
  loadVoiceProfile,
  upsertVoiceProfile,
  FIRM_DEFAULT_ADVISOR,
} from "@/lib/presentations/story/voice/repo";

export const dynamic = "force-dynamic";

/**
 * The profile that applies to the CALLING advisor — their own row, or the firm's
 * when they have none. `advisorUserId` rides along so the panel can tell the
 * advisor which of the two they are reading before they overwrite it.
 */
export async function GET() {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);
    const profile = await loadVoiceProfile(firmId, userId);
    return NextResponse.json({
      profile: profile
        ? { advisorUserId: profile.advisorUserId, styleNote: profile.styleNote }
        : null,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/story-voice error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Write the style note — this advisor's own row, or the firm's when
 * `firmDefault` is set.
 *
 * The role is re-checked HERE and not left to the checkbox that offers it: a
 * firm note is an instruction on every colleague's reports, and the schema flag
 * is caller-supplied.
 */
export async function PUT(request: NextRequest) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(storyVoiceProfilePutSchema, request);
    if (!parsed.ok) return parsed.response;
    const { styleNote, firmDefault } = parsed.data;

    if (firmDefault) await requireOrgAdminOrOwner();
    const advisorUserId = firmDefault ? FIRM_DEFAULT_ADVISOR : userId;
    await upsertVoiceProfile({ firmId, advisorUserId, styleNote, updatedBy: userId });

    await recordAudit({
      action: "story_voice.profile_updated",
      resourceType: "story_voice_profile",
      // The row's uuid is not returned by the upsert, and does not need to be:
      // (firm, advisor) is the table's unique key and `firmId` is already its
      // own audit column, so the advisor id names the row inside it. The firm
      // default's id is "", which would read as a missing value in the log.
      resourceId: advisorUserId === FIRM_DEFAULT_ADVISOR ? "firm-default" : advisorUserId,
      firmId,
      // The note itself is the advisor's prose and stays out of the log; its
      // length is enough to tell a real edit from a clear.
      metadata: { firmDefault, styleNoteLength: styleNote.length },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/story-voice error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
