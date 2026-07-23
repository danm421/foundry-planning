import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { generatePkce, generateState } from "@/lib/integrations/pkce";
import { createOauthState, upsertByokConnection } from "@/lib/integrations/connections";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { encodeAddeparSecret, encodeAddeparConfig } from "@/lib/integrations/providers/addepar/credentials";
import { testAddeparConnection } from "@/lib/integrations/providers/addepar/client";
import { recordAudit } from "@/lib/audit";
import { resolveProvider } from "../_provider";
import { addeparCredsSchema, buildAddeparTestContext } from "../_addepar";

const byokBody = addeparCredsSchema.extend({
  attestation: z.literal(true, "attestation required"),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  let provider: Awaited<ReturnType<typeof resolveProvider>> = null;
  try {
    provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });
    if (provider.authKind !== "oauth" || !provider.oauth) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // requireOrgAdminOrOwner() returns void — get ids from auth() separately
    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkIntegrationOauthLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} connection attempts. Please try again shortly.`);
    }

    const { verifier, challenge } = generatePkce();
    const state = generateState();
    const authorizeUrl = provider.oauth.buildAuthorizeUrl({ state, challenge });
    await createOauthState({ firmId, providerId: provider.id, userId, state, codeVerifier: verifier, ttlMs: 600_000 });
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    if (err instanceof ProviderNotConfigured) {
      return NextResponse.redirect(new URL(`/settings/integrations?error=${err.providerId}_not_configured`, req.url));
    }
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/[provider]/connect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * BYOK connect: accepts API credentials + attestation, validates them against
 * the live Addepar API via `testAddeparConnection` before persisting anything,
 * then stores them. Mirrors the OAuth callback's audit shape.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider) return new Response("Not found", { status: 404 });
    if (provider.authKind !== "byok") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkIntegrationOauthLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} connection attempts. Please try again shortly.`);
    }

    const parsed = byokBody.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { apiBase, addeparFirmId, apiKey, apiSecret } = parsed.data;
    const secretBlob = encodeAddeparSecret({ apiKey, apiSecret });
    const configBlob = encodeAddeparConfig({ apiBase, addeparFirmId });

    // Validate before persisting: build an ephemeral ctx and hit one read.
    // Only a failed credential test is an expected 400 — everything else
    // below (DB write, audit) falls through to the outer catch as a 500.
    try {
      await testAddeparConnection(
        buildAddeparTestContext({ firmId, providerId: provider.id, apiBase, addeparFirmId, secretBlob }),
      );
    } catch {
      return NextResponse.json(
        { error: "Could not connect to Addepar with those credentials." },
        { status: 400 },
      );
    }

    await upsertByokConnection({ firmId, providerId: provider.id, secretBlob, configBlob, userId });
    await recordAudit({
      action: "integration.connect",
      resourceType: "integration_connection",
      resourceId: firmId,
      firmId,
      metadata: { provider: provider.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/connect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
