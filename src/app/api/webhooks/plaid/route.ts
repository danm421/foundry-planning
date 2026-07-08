import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { plaidWebhookEvents } from "@/db/schema";
import { verifyPlaidWebhook } from "@/lib/plaid/webhook-verify";
import {
  plaidWebhookHandlers,
  type PlaidWebhookPayload,
} from "@/lib/plaid/webhook-handlers";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/plaid — receives Plaid webhook deliveries.
 *
 * Order of operations (mirrors the Stripe receiver):
 *   1. Read raw body (the JWT's request_body_sha256 covers bytes-as-sent).
 *   2. Verify the Plaid-Verification ES256 JWT. Reject 401 on any failure.
 *   3. Parse body; insert a plaid_webhook_events row (no event id exists in
 *      Plaid's model, so no dedup — handlers are idempotent instead).
 *   4. Look up handler by "<type>:<code>". Missing = 200 ignored.
 *   5. Run handler. Throw → error row + Sentry + 500 (Plaid retries).
 *   6. Update the event row with result/duration.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const verification = await verifyPlaidWebhook(
    rawBody,
    req.headers.get("plaid-verification"),
  );
  if (!verification.ok) {
    console.error("[webhook.plaid] verification failed:", verification.reason);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: PlaidWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as PlaidWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const webhookType = payload.webhook_type ?? "UNKNOWN";
  const webhookCode = payload.webhook_code ?? "UNKNOWN";

  const [row] = await db
    .insert(plaidWebhookEvents)
    .values({
      plaidItemId: payload.item_id ?? null,
      webhookType,
      webhookCode,
      environment: payload.environment ?? null,
      result: null,
    })
    .returning({ id: plaidWebhookEvents.id });
  const startedAt = Date.now();

  const finish = async (
    result: "ok" | "ignored" | "error",
    errorMessage: string | null = null,
  ) => {
    await db
      .update(plaidWebhookEvents)
      .set({
        result,
        errorMessage,
        processedAt: new Date(),
        processingDurationMs: Date.now() - startedAt,
      })
      .where(eq(plaidWebhookEvents.id, row.id));
  };

  const handler = plaidWebhookHandlers[`${webhookType}:${webhookCode}`];
  if (!handler) {
    await finish("ignored");
    return NextResponse.json({ ok: true, result: "ignored" }, { status: 200 });
  }

  try {
    const result = await handler(payload);
    await finish(result);
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error(`[webhook.plaid] handler failed for ${webhookType}:${webhookCode}:`, err);
    await finish("error", message);
    // Page ops only AFTER the error row is persisted; a Sentry transport
    // hiccup must not mask the 500 that tells Plaid to retry.
    try {
      Sentry.captureException(err, {
        extra: { webhookType, webhookCode, plaidItemId: payload.item_id, rowId: row.id },
      });
    } catch {
      // best-effort telemetry
    }
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
