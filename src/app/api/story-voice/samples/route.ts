import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  requireActiveSubscriptionForFirm,
  requireOrgAdminOrOwner,
  authErrorResponse,
} from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { storyVoiceSamplePostSchema } from "@/lib/schemas/story-voice";
import {
  insertVoiceSample,
  listVoiceSamples,
  FIRM_DEFAULT_ADVISOR,
} from "@/lib/presentations/story/voice/repo";
import { scrubSample } from "@/lib/presentations/story/voice/scrub";
import { loadStoryHousehold } from "@/lib/presentations/story/load-context";

export const dynamic = "force-dynamic";

/** Every sample that applies to this advisor — their own and the firm's. The
 *  panel shows the stored (already scrubbed) text, which is exactly what the
 *  model is sent. */
export async function GET() {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);
    const rows = await listVoiceSamples(firmId, userId);
    return NextResponse.json({
      samples: rows.map((r) => ({
        id: r.id,
        text: r.text,
        sourceChapterId: r.sourceChapterId,
        enabled: r.enabled,
        /** Shared with the firm, so the panel can say a colleague owns it. */
        firmDefault: r.advisorUserId === FIRM_DEFAULT_ADVISOR,
        /**
         * Did the NAME pass have a household to run against? The POST below
         * resolves names only when `sourceClientId` arrives, so a row without
         * one went through the figure pass alone. The panel says so per row —
         * a blanket "names were taken out" over a list holding both kinds is
         * false on half of it.
         *
         * The client id itself is deliberately NOT sent: which household a
         * colleague's firm-shared sample came from is not this reader's to
         * know, and the boolean is the whole of what the sentence needs.
         */
        scrubbedAgainstAHousehold: r.sourceClientId != null,
      })),
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/story-voice/samples error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Harvest one exemplar.
 *
 * ⚠️⚠️ `scrubSample` runs HERE, on the way in, and there is no path around it:
 * `insertVoiceSample` is called from this handler and nowhere else. Storing raw
 * text and scrubbing on read would leave one household's names sitting in a
 * table that another household's prompt reads, one missed call site away from a
 * leak. See the schema note on `story_voice_samples`.
 */
export async function POST(request: NextRequest) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(storyVoiceSamplePostSchema, request);
    if (!parsed.ok) return parsed.response;
    const { text, sourceChapterId, sourceClientId, firmDefault } = parsed.data;

    // A firm sample is sent to the model on every colleague's reports, so the
    // role is re-checked here and not merely on the checkbox that offers it.
    if (firmDefault) await requireOrgAdminOrOwner();

    // The household whose names have to come OUT. Read through the same access
    // check every client read uses — a caller naming a client they cannot see
    // gets a 404, not a scrub against somebody else's names.
    //
    // Scoped to `access.firmId`, the CLIENT's firm, not the caller's org. A
    // client shared from another firm is one this caller may legitimately
    // harvest from, and `loadStoryHousehold` is firm-scoped: hand it the
    // caller's org and it finds no row and THROWS, so every harvest from a
    // shared client would 500. Nothing unsafe — the fail is closed either way —
    // but a feature that is simply broken for shared clients.
    let household = { firstNames: "", householdName: "" };
    /** "own" until a source client says otherwise: with no client read, nothing
     *  crossed a firm boundary. */
    let sourceAccess: "own" | "shared" = "own";
    if (sourceClientId) {
      const access = await verifyClientAccess(sourceClientId);
      if (!access.ok) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      sourceAccess = access.access;
      household = await loadStoryHousehold(sourceClientId, access.firmId);
    }

    const scrubbed = scrubSample(text, household);
    const id = await insertVoiceSample({
      firmId,
      advisorUserId: firmDefault ? FIRM_DEFAULT_ADVISOR : userId,
      text: scrubbed,
      sourceChapterId,
      sourceClientId,
      createdBy: userId,
    });

    await recordAudit({
      action: "story_voice.sample_added",
      resourceType: "story_voice_sample",
      resourceId: id,
      clientId: sourceClientId,
      firmId,
      // The row lands in the CALLER's firm while the prose came from a client
      // that may belong to another — stamp who really did it, the same way the
      // other cross-firm-capable client routes do.
      metadata: crossFirmAuditMeta({ access: sourceAccess }, firmId, {
        sourceChapterId,
        firmDefault,
      }),
    });

    // The SCRUBBED text goes back, so the advisor reads exactly what the model
    // will — the panel shows it before they enable it.
    return NextResponse.json({ id, text: scrubbed });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/story-voice/samples error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
