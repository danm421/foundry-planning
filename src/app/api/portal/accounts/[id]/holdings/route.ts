import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { assertPortalVisibleTarget } from "@/lib/portal/assert-portal-visible-target";
import { loadEnrichedHoldings } from "@/lib/investments/load-enriched-holdings";
import { toPortalHoldings } from "@/lib/portal/portal-holdings";

export const dynamic = "force-dynamic";

/**
 * The positions inside one portal-visible account — what the Accounts drawer's
 * Holdings tab renders.
 *
 * Behind the advisor's `investments` switch: these are the same holdings the
 * Investments section shows, so answering here while that section is off would
 * hand the data back one fetch later. Cash accounts never reach this route —
 * their "Cash" row is the balance the drawer already displays.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    // Act-as aware, like the transactions route, so advisor preview reads the
    // client's holdings rather than 403ing on its own account lookup.
    const { clientId } = await resolvePortalClient();
    await requirePortalFeature(clientId, "investments");
    const { id } = await ctx.params;
    const target = await assertPortalVisibleTarget(clientId, id);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
    const byAccount = await loadEnrichedHoldings([id]);
    return NextResponse.json({ holdings: toPortalHoldings(byAccount.get(id) ?? []) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
