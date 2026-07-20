import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { checkIntegrationApiLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { makeCallContext } from "@/lib/integrations/auth";
import { getHouseholdLinks } from "@/lib/integrations/households";
import { resolveProvider } from "../_provider";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

    const rl = await checkIntegrationApiLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) return rateLimitErrorResponse(rl, `Too many ${provider.label} requests. Please try again shortly.`);

    const [households, links] = await Promise.all([
      provider.client.getHouseholds(makeCallContext(firmId, provider.id)),
      getHouseholdLinks(firmId, provider.id),
    ]);
    const linkByHousehold = new Map(links.map((l) => [l.externalHouseholdId, l.clientId]));
    return NextResponse.json({
      households: households.map((h) => ({ ...h, linkedClientId: linkByHousehold.get(h.id) ?? null })),
    });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/[provider]/households error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
