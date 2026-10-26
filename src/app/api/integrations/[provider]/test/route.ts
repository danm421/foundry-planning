// src/app/api/integrations/[provider]/test/route.ts
//
// Pre-save "Test connection" button: validates BYOK credentials against the
// live provider and reports ok/error. Stores nothing — no connections
// table write, no audit entry. The connect route re-validates independently
// before persisting. Any advisor may test an Addepar key (the connection will
// be their own); Azure's test stays admin-only, like its connect.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { CredentialsRejected } from "@/lib/integrations/errors";
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

    const isAzure = provider.id === "azure_openai";
    // Azure's test makes the server call whatever endpoint the body names.
    if (isAzure) await requireOrgAdminOrOwner();
    const { orgId: firmId, userId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Azure buckets per firm, Addepar per advisor (as connect does), so one
    // advisor's tests can't 429 a colleague.
    const rl = await checkIntegrationOauthLimit(`${provider.id}:${isAzure ? firmId : userId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, `Too many ${provider.label} connection attempts. Please try again shortly.`);
    }

    if (isAzure) {
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
    } catch (err) {
      const error = err instanceof CredentialsRejected ? err.message : "Could not reach Addepar.";
      return NextResponse.json({ ok: false, error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/test error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
