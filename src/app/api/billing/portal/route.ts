import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { requireOrgOwner, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function originFor(req: Request): string {
  const fromHeader = req.headers.get("origin");
  if (fromHeader) return fromHeader;
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

export async function POST(req: Request): Promise<Response> {
  try {
    await requireOrgOwner();
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
      return_url: `${originFor(req)}/settings/billing`,
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
