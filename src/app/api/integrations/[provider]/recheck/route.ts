// src/app/api/integrations/[provider]/recheck/route.ts
//
// Re-runs the connection checks against a firm's STORED credentials and updates
// the connection status. Two things only this route can do: clear an `error`
// badge once a firm has fixed things in Azure, and surface a Forge-side auth
// failure at all — the extraction path flips the badge on its own, but Forge
// invokes the model deep inside LangChain where we do not own the call site.
//
// It takes no request body. Everything it verifies is already stored, which is
// the point: an admin who sees AI failing presses one button and gets a
// definitive answer without retyping a key.
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { checkIntegrationOauthLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import {
  getConnection,
  setConnectionStatus,
  type IntegrationConnectionRow,
} from "@/lib/integrations/connections";
import { decodeAzureConfig, decodeAzureSecret, type AiCredentials } from "@/lib/ai/credentials";
import { clearAiCredentialCache } from "@/lib/ai/resolve";
import { verifyAzureConnection } from "@/lib/ai/verify-connection";
import { recordAudit } from "@/lib/audit";
import { credsToAiCredentials, firstFailureMessage } from "../_azure";
import { resolveProvider } from "../_provider";

// 4 sequential verification calls at 45s each (see VERIFY_TIMEOUT_MS in
// src/lib/ai/verify-connection.ts) = 180s worst case, inside this budget.
export const maxDuration = 300;

/** What the status row records when the stored credentials cannot be read at
 *  all — either the envelope will not DECRYPT or the decrypted blobs will not
 *  DECODE. It names the cause and quotes NONE of the stored value: JSON.parse's
 *  SyntaxError embeds the first ~10 characters of its input, which is why
 *  decodeAzureSecret rethrows a fixed string in the first place. This string is
 *  rendered to the admin (AzureOpenAiCard's error state), so it says what to do
 *  next rather than naming an internal cause they cannot act on. */
const UNREADABLE = "Stored credentials could not be read. Reconnect to fix this.";

/**
 * One outcome write: status row, then cache clear, then audit.
 *
 * The order matters and mirrors connect/disconnect. Clearing the cache BEFORE
 * the status write would let a concurrent request re-read a row that still says
 * "connected" and put the stale entry straight back — the resolver holds firm
 * credentials for 60s per instance.
 *
 * Not exported: a route file may only export handlers and route config.
 */
async function recordOutcome(firmId: string, ok: boolean, detail: string | null): Promise<void> {
  await setConnectionStatus(firmId, "azure_openai", ok ? "connected" : "error", detail);
  clearAiCredentialCache(firmId);
  // Recheck is an admin action, so it audits — the same shape connect and
  // disconnect use. (The two SYSTEM-driven status writes, in integrations/auth.ts
  // and the extraction path, deliberately do not.) No endpoint, no key: the
  // outcome is the whole record.
  await recordAudit({
    action: "integration.recheck",
    resourceType: "integration_connection",
    resourceId: firmId,
    firmId,
    metadata: { provider: "azure_openai", ok },
  });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  try {
    const provider = await resolveProvider(params);
    if (!provider || provider.id !== "azure_openai") {
      return new Response("Not found", { status: 404 });
    }

    await requireOrgAdminOrOwner();
    const { orgId: firmId } = await auth();
    if (!firmId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    const rl = await checkIntegrationOauthLimit(`${provider.id}:${firmId}`);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many checks. Please try again shortly.");
    }

    // getConnection DECRYPTS eagerly (connections.ts -> crypto/secrets.ts, which
    // throws "Unrecognized secret envelope"), so a rotated
    // CREDENTIAL_ENCRYPTION_KEY, a cross-environment restore or a legacy row
    // throws HERE — before the decode guard below ever runs. Same ruling: a
    // stored credential that cannot be read is a FAILED CHECK, not a 500 from
    // the one button whose whole purpose is explaining what is wrong.
    //
    // Flipping to `error` is safe on this path specifically: disconnectConnection
    // blanks accessTokenEnc to "", and getConnection skips the decrypt on a
    // falsy blob — so a row that can throw here necessarily still holds
    // credentials, and is never one the firm deliberately disconnected.
    let conn: IntegrationConnectionRow | null;
    try {
      conn = await getConnection(firmId, "azure_openai");
    } catch {
      await recordOutcome(firmId, false, UNREADABLE);
      return NextResponse.json({ ok: false, checks: [] });
    }
    if (!conn || conn.status === "disconnected") {
      return NextResponse.json({ error: "No Azure OpenAI connection." }, { status: 404 });
    }

    // A stored blob that will not decode is a FAILED CHECK, not a 500. This is
    // the one button whose entire purpose is telling an admin what is wrong,
    // and "Internal server error" tells them nothing — while the row would sit
    // on `connected` claiming AI works. Only the decode is inside this try;
    // widening it would mislabel a verifier fault as a corrupt credential.
    let creds: AiCredentials;
    try {
      const { apiKey } = decodeAzureSecret(conn.accessToken ?? "");
      creds = credsToAiCredentials({ apiKey, ...decodeAzureConfig(conn.scope) });
    } catch {
      await recordOutcome(firmId, false, UNREADABLE);
      return NextResponse.json({ ok: false, checks: [] });
    }

    const result = await verifyAzureConnection(creds);
    await recordOutcome(firmId, result.ok, result.ok ? null : firstFailureMessage(result.checks));

    // `{ ok, checks }` and nothing else, spelled out field by field. AiCredentials
    // bundles the apiKey with the four fields a status UI wants, so the type
    // system gives Constraint 7 no help — one careless `NextResponse.json(creds)`
    // would put a firm's key in the browser.
    return NextResponse.json({ ok: result.ok, checks: result.checks });
  } catch (err) {
    const resp = authErrorResponse(err);
    if (resp) return NextResponse.json(resp.body, { status: resp.status });
    console.error("POST /api/integrations/[provider]/recheck error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
