import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { loadPortalDashboard } from "@/lib/portal/load-dashboard";
import { DEFAULT_PORTAL_PRIVACY, loadPortalPrivacy } from "@/lib/portal/privacy";
import { loadPortalFeatures } from "@/lib/portal/load-features";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    // A client always sees their own data (all-on); advisor preview respects
    // the client's sharing switches — mirrors <PortalDashboard>.
    const sharing =
      mode === "advisor" ? await loadPortalPrivacy(clientId) : DEFAULT_PORTAL_PRIVACY;
    // The advisor's section switches apply to mobile too, or switching Budget
    // off would take the tiles off the web dashboard and leave them on the
    // phone. The DTO echoes `budgetEnabled` so the app can drop them.
    const features = await loadPortalFeatures(clientId);
    // The mobile home screen now renders a Goals funded tile beside net worth,
    // matching how the web dashboard leads. That tile needs the base-case
    // projection, so this route pays for it — the reason it used to opt out.
    const dto = await loadPortalDashboard(clientId, new Date(), sharing, {
      includeGoals: true,
      budgetEnabled: features.budget,
    });
    return NextResponse.json(dto);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
