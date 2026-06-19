import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { checkOrionApiLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { OrionClient } from "@/lib/orion/client";
import { getHouseholdLinks } from "@/lib/orion/households";

export async function GET(): Promise<Response> {
  try {
    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

    const rl = await checkOrionApiLimit(firmId);
    if (!rl.allowed) return rateLimitErrorResponse(rl, "Too many Orion requests. Please try again shortly.");

    const [households, links] = await Promise.all([
      new OrionClient({ firmId }).getHouseholds(),
      getHouseholdLinks(firmId),
    ]);
    const linkByHousehold = new Map(links.map((l) => [l.orionHouseholdId, l.clientId]));
    return NextResponse.json({
      households: households.map((h) => ({ ...h, linkedClientId: linkByHousehold.get(h.id) ?? null })),
    });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/orion/households error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
