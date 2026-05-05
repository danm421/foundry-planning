import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { billingEvents } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { handlers } from "@/lib/billing/webhook-handlers";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe — receives Stripe webhook deliveries.
 *
 * Order of operations (do not reorder — each step blocks the next):
 *   1. Read raw body (HMAC verification requires bytes-as-sent).
 *   2. Verify signature via Stripe SDK. Reject 400 on mismatch.
 *   3. INSERT billing_events ON CONFLICT DO NOTHING. Empty returning =
 *      duplicate delivery (already processed) → 200 skipped_duplicate.
 *   4. Look up handler by event type. Missing = 200 ignored.
 *   5. Run handler. Throw → 500 (Stripe retries up to 72h).
 *   6. UPDATE billing_events with result/duration/error.
 *
 * NEVER read event.data.object directly in handlers — handlers re-fetch
 * via the Stripe API (source-of-truth pattern). The route doesn't enforce
 * that, but the dispatch contract does.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook.stripe] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: import("stripe").Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error(
      "[webhook.stripe] signature verification failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const inserted = await db
    .insert(billingEvents)
    .values({
      stripeEventId: event.id,
      eventType: event.type,
      result: null,
    })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });

  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, result: "skipped_duplicate" }, { status: 200 });
  }
  const rowId = inserted[0].id;
  const startedAt = Date.now();

  const handler = handlers[event.type];
  if (!handler) {
    await db
      .update(billingEvents)
      .set({
        result: "ignored",
        processedAt: new Date(),
        processingDurationMs: Date.now() - startedAt,
      })
      .where(eq(billingEvents.id, rowId));
    return NextResponse.json({ ok: true, result: "ignored" }, { status: 200 });
  }

  try {
    await handler(event);
    await db
      .update(billingEvents)
      .set({
        result: "ok",
        processedAt: new Date(),
        processingDurationMs: Date.now() - startedAt,
      })
      .where(eq(billingEvents.id, rowId));
    return NextResponse.json({ ok: true, result: "ok" }, { status: 200 });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    // Console gets the full err object (with stack + cause chain) so truncated
    // DB rows don't hide the root cause when debugging webhook failures.
    console.error(`[webhook.stripe] handler failed for ${event.type}:`, err);
    await db
      .update(billingEvents)
      .set({
        result: "error",
        errorMessage: message,
        processedAt: new Date(),
        processingDurationMs: Date.now() - startedAt,
      })
      .where(eq(billingEvents.id, rowId));
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
