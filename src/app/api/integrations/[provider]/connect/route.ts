import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { generatePkce, generateState } from "@/lib/integrations/pkce";
import { createByokConnection, createOauthState, upsertByokConnection } from "@/lib/integrations/connections";
import { ProviderNotConfigured } from "@/lib/integrations/errors";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { verifyAzureConnection } from "@/lib/ai/verify-connection";
import { encodeAzureSecret, encodeAzureConfig } from "@/lib/ai/credentials";
import { clearAiCredentialCache } from "@/lib/ai/resolve";
import { resolveProvider } from "../_provider";
import { readTestedAddeparCredentials } from "../_addepar";
import { azureCredsSchema, credsToAiCredentials, firstFailureMessage } from "../_azure";

// 4 sequential verification calls at 45s each (see VERIFY_TIMEOUT_MS in
// src/lib/ai/verify-connection.ts) = 180s worst case, inside this budget.
export const maxDuration = 300;

const azureBody = azureCredsSchema.extend({
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

    // Open to every advisor: the connection is their own.
    const { orgId: firmId, userId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Per advisor, so one advisor's attempts can't 429 a colleague.
    const rl = await checkIntegrationOauthLimit(`${provider.id}:${userId}`);
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
      return NextResponse.redirect(new URL(`/settings/integrations/${err.providerId}?error=${err.providerId}_not_configured`, req.url));
    }
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("GET /api/integrations/[provider]/connect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * BYOK connect: accepts API credentials + attestation, validates them against
 * the live provider before persisting anything, then stores them.
 *  - Azure OpenAI: the firm's one connection, set by an admin or owner.
 *  - Addepar: any advisor adds a connection of their own (they may hold
 *    several), named by them; returns its id.
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

    const isAzure = provider.id === "azure_openai";
    // Azure is the firm's one connection, so only an admin or owner sets it.
    // requireOrgAdminOrOwner() returns void — get ids from auth() separately.
    if (isAzure) await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await requireActiveSubscriptionForFirm(firmId);

    // Azure's one connection buckets per firm; Addepar's per advisor, so one
    // advisor's attempts can't 429 a colleague.
    const rl = await checkIntegrationOauthLimit(`${provider.id}:${isAzure ? firmId : userId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} connection attempts. Please try again shortly.`);
    }

    if (isAzure) {
      const parsedAzure = azureBody.safeParse(await req.json());
      if (!parsedAzure.success) {
        return NextResponse.json(
          { error: parsedAzure.error.issues[0]?.message ?? "Invalid input" },
          { status: 400 },
        );
      }
      // Nothing spreads `creds` — every downstream use names an explicit
      // field — so this is exactly equivalent to destructuring off
      // `attestation` and carries no unused-var warning.
      const creds = parsedAzure.data;

      // Validate before persisting — same ordering as the Addepar path.
      const result = await verifyAzureConnection(credsToAiCredentials(creds));
      if (!result.ok) {
        return NextResponse.json(
          { error: firstFailureMessage(result.checks), checks: result.checks },
          { status: 400 },
        );
      }

      await upsertByokConnection({
        firmId,
        providerId: provider.id,
        secretBlob: encodeAzureSecret({ apiKey: creds.apiKey }),
        configBlob: encodeAzureConfig({
          endpoint: creds.endpoint,
          apiVersion: creds.apiVersion,
          chatDeployment: creds.chatDeployment,
          miniDeployment: creds.miniDeployment,
          embeddingDeployment: creds.embeddingDeployment,
        }),
        userId,
      });
      // This instance now holds a stale "no connection" entry; other instances
      // age out within the resolver's TTL.
      clearAiCredentialCache(firmId);
      await recordAudit({
        action: "integration.connect",
        resourceType: "integration_connection",
        resourceId: firmId,
        firmId,
        metadata: { provider: provider.id, endpoint: creds.endpoint },
      });
      return NextResponse.json({ ok: true });
    }

    const tested = await readTestedAddeparCredentials(req, firmId);
    if ("error" in tested) return NextResponse.json({ error: tested.error }, { status: 400 });

    // Always a new row: an advisor may hold several Addepar connections.
    const connectionId = await createByokConnection({ firmId, ownerUserId: userId, ...tested });
    await recordAudit({
      action: "integration.connect",
      resourceType: "integration_connection",
      resourceId: connectionId,
      firmId,
      metadata: { provider: provider.id, connectionId },
    });
    return NextResponse.json({ ok: true, connectionId });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/connect error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
