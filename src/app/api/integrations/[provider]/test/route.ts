// src/app/api/integrations/[provider]/test/route.ts
//
// Pre-save "Test connection" button: validates BYOK credentials against the
// live Addepar API and reports ok/error. Stores nothing — no connections
// table write, no audit entry. The connect route re-validates independently
// before persisting.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { testAddeparConnection } from "@/lib/integrations/providers/addepar/client";
import { encodeAddeparSecret } from "@/lib/integrations/providers/addepar/credentials";
import { verifyAzureConnection } from "@/lib/ai/verify-connection";
import { resolveProvider } from "../_provider";
import { addeparCredsSchema, buildAddeparTestContext } from "../_addepar";
import { azureCredsSchema, credsToAiCredentials } from "../_azure";

// 4 sequential verification calls at 45s each (see VERIFY_TIMEOUT_MS in
// src/lib/ai/verify-connection.ts) = 180s worst case, inside this budget.
export const maxDuration = 300;

const body = addeparCredsSchema;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider || provider.authKind !== "byok") {
      return new Response("Not found", { status: 404 });
    }

    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    const rl = await checkIntegrationOauthLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} connection attempts. Please try again shortly.`);
    }

    if (provider.id === "azure_openai") {
      const parsedAzure = azureCredsSchema.safeParse(await req.json());
      if (!parsedAzure.success) {
        return NextResponse.json(
          { ok: false, error: parsedAzure.error.issues[0]?.message ?? "Invalid input" },
          { status: 400 },
        );
      }
      const result = await verifyAzureConnection(credsToAiCredentials(parsedAzure.data));
      return NextResponse.json(
        { ok: result.ok, checks: result.checks },
        { status: result.ok ? 200 : 400 },
      );
    }

    const parsed = body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { apiBase, addeparFirmId, apiKey, apiSecret } = parsed.data;
    const secretBlob = encodeAddeparSecret({ apiKey, apiSecret });

    // Only a failed credential test is an expected 400 — anything else is
    // unexpected and falls through to the outer catch as a 500.
    try {
      await testAddeparConnection(
        buildAddeparTestContext({ firmId, providerId: provider.id, apiBase, addeparFirmId, secretBlob }),
      );
    } catch {
      return NextResponse.json({ ok: false, error: "Could not reach Addepar." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/test error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
