import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { checkIntegrationApiLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { makeCallContext } from "@/lib/integrations/auth";
import { getHouseholdLinks } from "@/lib/integrations/households";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { resolveProvider } from "../_provider";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  let provider: Awaited<ReturnType<typeof resolveProvider>> = null;
  try {
    provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });

    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

    const rl = await checkIntegrationApiLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) return rateLimitErrorResponse(rl, `Too many ${provider.label} requests. Please try again shortly.`);

    const activeProvider = provider;
    if (!activeProvider.syncs) return new Response("Not found", { status: 404 });
    const ctxPromise = makeCallContext(firmId, activeProvider.id);
    const [households, links] = await Promise.all([
      ctxPromise.then((ctx) => activeProvider.client.getHouseholds(ctx)),
      getHouseholdLinks(firmId, activeProvider.id),
    ]);
    const linkByHousehold = new Map(links.map((l) => [l.externalHouseholdId, l.clientId]));
    const linkerByHousehold = new Map(
      links.map((l) => [l.externalHouseholdId, l.linkedByUserId]),
    );
    const names = await resolveActors(
      [...new Set(links.map((l) => l.linkedByUserId).filter((v): v is string => !!v))],
    );
    return NextResponse.json({
      households: households.map((h) => {
        const linker = linkerByHousehold.get(h.id) ?? null;
        return {
          ...h,
          linkedClientId: linkByHousehold.get(h.id) ?? null,
          linkedByName: linker ? (names.get(linker)?.name ?? null) : null,
        };
      }),
    });
  } catch (err) {
    if (err instanceof ProviderNotConfigured) {
      return NextResponse.json({ error: `${err.providerId} is not yet configured` }, { status: 503 });
    }
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/[provider]/households error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
