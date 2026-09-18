import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/billing/stripe-client";
import { billingPlanForPriceId, type BillingPlan } from "@/lib/billing/billing-plan";
import { getPriceCatalog } from "@/lib/billing/price-catalog";
import { getPlanSwitchPortalConfigurationId } from "@/lib/billing/portal-plan-switch";
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

export async function POST(request: Request): Promise<Response> {
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
    .select({
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      status: subscriptions.status,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
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
    const rawPlan = String((await request.formData()).get("plan") ?? "");
    const targetPlan: BillingPlan | null =
      rawPlan === "monthly" || rawPlan === "annual" ? rawPlan : null;
    if (rawPlan && !targetPlan) {
      return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
    }

    let sessionParams: Parameters<typeof stripe.billingPortal.sessions.create>[0] = {
      customer,
      return_url: `${appOrigin()}/settings/billing`,
    };

    let currentPlan: BillingPlan | null = null;
    let planSwitchEffective: "immediately" | "at_period_end" | null = null;
    if (targetPlan) {
      if (
        !row ||
        !["trialing", "active"].includes(row.status) ||
        row.cancelAtPeriodEnd
      ) {
        return NextResponse.json({ error: "plan_change_unavailable" }, { status: 400 });
      }
      const subscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      const seatItem = subscription.items.data.find((item) => {
        const priceId = typeof item.price === "string" ? item.price : item.price.id;
        return billingPlanForPriceId(priceId) !== null;
      });
      if (!seatItem) {
        return NextResponse.json({ error: "plan_change_unavailable" }, { status: 400 });
      }
      const currentPriceId =
        typeof seatItem.price === "string" ? seatItem.price : seatItem.price.id;
      currentPlan = billingPlanForPriceId(currentPriceId);
      if (currentPlan === targetPlan) {
        return NextResponse.json({ error: "already_on_plan" }, { status: 400 });
      }
      const catalog = getPriceCatalog();
      // Stripe's own status, not the mirror's: the mirror can lag a webhook,
      // and getting this wrong in the "trialing" direction would re-anchor a
      // renewal the customer has already paid for. An unreadable status falls
      // through to deferring, which is the side that cannot cost them money.
      const deferToPeriodEnd = subscription.status !== "trialing";
      planSwitchEffective = deferToPeriodEnd ? "at_period_end" : "immediately";
      const configuration = await getPlanSwitchPortalConfigurationId(stripe, {
        deferToPeriodEnd,
      });
      // A deferred switch leaves the cycle on screen unchanged until the paid
      // period runs out, so the page has to greet them with that and not with
      // a confirmation that nothing on the page will bear out.
      const returnUrl = `${appOrigin()}/settings/billing?plan_changed=${
        deferToPeriodEnd ? "scheduled" : "1"
      }`;
      sessionParams = {
        ...sessionParams,
        configuration,
        flow_data: {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: row.stripeSubscriptionId,
            items: [{
              id: seatItem.id,
              price: targetPlan === "monthly" ? catalog.seatMonthly : catalog.seatAnnual,
              quantity: seatItem.quantity ?? 1,
            }],
          },
          after_completion: {
            type: "redirect",
            redirect: { return_url: returnUrl },
          },
        },
      };
    }

    const session = await stripe.billingPortal.sessions.create(sessionParams);
    await recordAudit({
      action: "billing.portal_opened",
      resourceType: "subscription",
      resourceId: customer,
      firmId: orgId,
      metadata: targetPlan
        ? {
            flow: "plan_switch",
            from_plan: currentPlan,
            to_plan: targetPlan,
            effective: planSwitchEffective,
          }
        : { flow: "portal_home" },
    });
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("[billing/portal] stripe error:", err);
    return NextResponse.json({ error: "portal_unavailable" }, { status: 500 });
  }
}
