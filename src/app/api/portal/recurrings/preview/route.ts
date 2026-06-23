import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { previewRecurringMatches } from "@/lib/portal/claim-recurring";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    const qp = new URL(req.url).searchParams;
    const matchType = qp.get("matchType");
    const pattern = qp.get("pattern") ?? "";
    const amountMin = Number(qp.get("amountMin"));
    const amountMax = Number(qp.get("amountMax"));
    if (matchType !== "exact" && matchType !== "contains") {
      return NextResponse.json({ error: "invalid matchType" }, { status: 400 });
    }
    if (!Number.isFinite(amountMin) || !Number.isFinite(amountMax) || amountMin > amountMax) {
      return NextResponse.json({ error: "invalid amount range" }, { status: 400 });
    }
    const result = await previewRecurringMatches(clientId, { matchType, pattern, amountMin, amountMax });
    return NextResponse.json(result);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
