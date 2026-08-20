import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { requireAreaShared } from "@/lib/portal/privacy";
import { loadRecurringSuggestions } from "@/lib/portal/load-recurring-suggestions";

export const dynamic = "force-dynamic";

/** The Recurring tab already arrives with its own short list of suggestions.
 *  This is the client asking us to look again, harder — `scope=wide` drops the
 *  cap, forgives a bill that skipped a month, and accepts two matching charges
 *  as a rhythm. Read-only: accepting one still goes through POST /recurrings,
 *  which is where the subscription and edit gates live. */
export async function GET(req: Request): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalFeature(clientId, "budget");
    await requireAreaShared(mode, clientId, "recurrings");
    const scope = new URL(req.url).searchParams.get("scope");
    const suggestions = await loadRecurringSuggestions(
      clientId,
      new Date(),
      scope === "wide" ? "wide" : "strict",
    );
    return NextResponse.json({ suggestions });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
