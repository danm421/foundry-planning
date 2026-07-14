import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { loadPortalTrusts } from "@/lib/portal/load-profile-data";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    return NextResponse.json({ trusts: await loadPortalTrusts(clientId) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
