import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { loadPortalDashboard } from "@/lib/portal/load-dashboard";
import { DEFAULT_PORTAL_PRIVACY, loadPortalPrivacy } from "@/lib/portal/privacy";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    // A client always sees their own data (all-on); advisor preview respects
    // the client's sharing switches — mirrors <PortalDashboard>.
    const sharing =
      mode === "advisor" ? await loadPortalPrivacy(clientId) : DEFAULT_PORTAL_PRIVACY;
    const dto = await loadPortalDashboard(clientId, new Date(), sharing);
    return NextResponse.json(dto);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
