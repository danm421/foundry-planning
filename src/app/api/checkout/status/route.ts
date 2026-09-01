import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { firms, subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { checkCheckoutStatusRateLimit, extractClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Stripe Checkout session IDs match cs_(test|live)_<base64url>; we keep the
// regex liberal but anchored so we reject obvious garbage at the edge before
// burning a Stripe API call.
const SESSION_ID_RE = /^cs_(test|live)_[a-zA-Z0-9_-]{10,}$/;

// This endpoint is unauthenticated (a checkout session id is the only
// credential), so never return the full purchase email — the success page
// only needs a recognizable hint of where the invite went.
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

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
    .select({ firmId: firms.firmId, firmName: firms.displayName })
    .from(subscriptions)
    .innerJoin(firms, eq(subscriptions.firmId, firms.firmId))
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ ready: false });
  }

  const firmId = rows[0]!.firmId;

  // The DB row is NOT the readiness signal. checkout-session-completed stamps
  // the Clerk org's public_metadata last, and proxy.ts blocks a `missing`
  // subscription state unconditionally — so activating the org between those
  // two writes sends a buyer who just paid to the billing lockout. Ready means
  // "they can actually get in", which is the stamped metadata.
  let stamped = false;
  try {
    const cc = await clerkClient();
    const org = await cc.organizations.getOrganization({ organizationId: firmId });
    const meta = (org.publicMetadata ?? {}) as { subscription_status?: unknown };
    stamped = typeof meta.subscription_status === "string";
  } catch (err) {
    console.error("[checkout/status] could not read the Clerk org:", err);
    return NextResponse.json({ ready: false });
  }
  if (!stamped) {
    return NextResponse.json({ ready: false });
  }

  // The firm id goes only to the buyer themselves — it is what /checkout/success
  // passes to setActive(). Everyone else (the sales path, or a stranger holding
  // the session id) gets today's masked shape.
  const { userId } = await auth();
  const isBuyer = !!userId && userId === session.client_reference_id;

  return NextResponse.json({
    ready: true,
    firmName: rows[0]!.firmName,
    buyerEmail: maskEmail(buyerEmail),
    ...(isBuyer ? { firmId } : {}),
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
