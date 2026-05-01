import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { firms, subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkCheckoutStatusRateLimit, extractClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Stripe Checkout session IDs match cs_(test|live)_<base64url>; we keep the
// regex liberal but anchored so we reject obvious garbage at the edge before
// burning a Stripe API call.
const SESSION_ID_RE = /^cs_(test|live)_[a-zA-Z0-9_-]{10,}$/;

export async function GET(req: Request): Promise<Response> {
  const ip = extractClientIp(req);
  const rl = await checkCheckoutStatusRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
    return NextResponse.json({ error: "invalid_session_id" }, { status: 400 });
  }

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer_details"],
    });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404) {
      return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    }
    console.error("[checkout/status] stripe error:", err);
    return NextResponse.json({ error: "stripe_error" }, { status: 500 });
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const buyerEmail = session.customer_details?.email;

  if (!customerId || !buyerEmail) {
    // Session exists but is incomplete — buyer hasn't finished payment yet.
    return NextResponse.json({ ready: false });
  }

  const rows = await db
    .select({ firmName: firms.displayName })
    .from(subscriptions)
    .innerJoin(firms, eq(subscriptions.firmId, firms.firmId))
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ ready: false });
  }

  return NextResponse.json({
    ready: true,
    firmName: rows[0]!.firmName,
    buyerEmail,
  });
}

function rateLimitHeaders(
  rl: Extract<
    Awaited<ReturnType<typeof checkCheckoutStatusRateLimit>>,
    { allowed: false }
  >,
): Record<string, string> {
  if ("reset" in rl && typeof rl.reset === "number") {
    const seconds = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
    return { "Retry-After": String(seconds) };
  }
  return {};
}
