import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { loadAccountsOverview } from "@/lib/portal/load-accounts-overview";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    const dto = await loadAccountsOverview(clientId);
    return NextResponse.json(dto);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
