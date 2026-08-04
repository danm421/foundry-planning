import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { requireBillingContact, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Origin used solely as Stripe's `return_url` (the "return to merchant" link
// inside Stripe's hosted portal). This never was a server-controlled redirect,
// so reading the caller's Origin header could not have caused an open redirect
// — but taking it from configuration instead means that argument doesn't have
// to be re-derived on every read, and it matches the convention every other
// redirect and mailer in the app already uses.
function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

export async function POST(): Promise<Response> {
  try {
    await requireBillingContact();
  } catch (err) {
    const mapped = authErrorResponse(err);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
    throw err;
  }

  // firmId === Clerk org id.
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  const row = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, orgId))
    .orderBy(desc(subscriptions.createdAt))
    .then((r) => r[0]);

  const customer = row?.stripeCustomerId;
  if (!customer) {
    // Founder / never-purchased: no Stripe customer to manage.
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${appOrigin()}/settings/billing`,
    });
    await recordAudit({
      action: "billing.portal_opened",
      resourceType: "subscription",
      resourceId: customer,
      firmId: orgId,
    });
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("[billing/portal] stripe error:", err);
    return NextResponse.json({ error: "portal_unavailable" }, { status: 500 });
  }
}
