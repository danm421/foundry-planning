import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { loadPortalInvestments } from "@/lib/portal/load-portal-investments";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalFeature(clientId, "investments");
    const dto = await loadPortalInvestments(clientId);
    return NextResponse.json(dto);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
