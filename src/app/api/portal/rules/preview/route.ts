import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireAreaShared } from "@/lib/portal/privacy";
import { countRuleMatches } from "@/lib/portal/recategorize";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    // Act-as aware so advisor "preview as client" sees the same match count.
    const { clientId, mode } = await resolvePortalClient();
    await requireAreaShared(mode, clientId, "budgets");
    const qp = new URL(req.url).searchParams;
    const matchType = qp.get("matchType");
    const pattern = qp.get("pattern") ?? "";
    if (matchType !== "exact" && matchType !== "contains") {
      return NextResponse.json({ error: "invalid matchType" }, { status: 400 });
    }
    const count = await countRuleMatches(clientId, matchType, pattern);
    return NextResponse.json({ count });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
