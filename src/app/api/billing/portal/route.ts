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

// Keep all return URLs on the configured app origin.
function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
}

// Native form submissions need a page with an explanation, not a JSON body.
function billingError(code: string, details: Record<string, string> = {}): Response {
  const query = new URLSearchParams({ billing_error: code, ...details });
  return NextResponse.redirect(
    `${appOrigin()}/settings/billing?${query}`,
    303,
  );
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
    return billingError("no_subscription");
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
    return billingError("no_subscription");
  }

  let releasedSchedule: string | null = null;
  try {
    const stripe = getStripe();
    const form = await request.formData();
    const rawPlan = String(form.get("plan") ?? "");
    const targetPlan: BillingPlan | null =
      rawPlan === "monthly" || rawPlan === "annual" ? rawPlan : null;
    if (rawPlan && !targetPlan) {
      return billingError("invalid_plan");
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
        return billingError("plan_change_unavailable");
      }
      const subscription = await stripe.subscriptions.retrieve(row.stripeSubscriptionId);
      // The local mirror can lag cancellation or payment-status webhooks.
      if (
        !["trialing", "active"].includes(subscription.status) ||
        subscription.cancel_at_period_end || subscription.cancel_at
      ) {
        return billingError("plan_change_unavailable");
      }
      const seatItem = subscription.items.data.find((item) => {
        const priceId = typeof item.price === "string" ? item.price : item.price.id;
        return billingPlanForPriceId(priceId) !== null;
      });
      if (!seatItem) {
        return billingError("plan_change_unavailable");
      }
      const currentPriceId =
        typeof seatItem.price === "string" ? seatItem.price : seatItem.price.id;
      currentPlan = billingPlanForPriceId(currentPriceId);
      if (currentPlan === targetPlan) {
        return billingError("already_on_plan");
      }
      const catalog = getPriceCatalog();
      // Paid periods must finish before shortening the billing interval.
      const deferToPeriodEnd = subscription.status !== "trialing";
      planSwitchEffective = deferToPeriodEnd ? "at_period_end" : "immediately";

      // Stripe won't open a plan-switch session while a schedule owns the subscription.
      const scheduleId =
        typeof subscription.schedule === "string"
          ? subscription.schedule
          : (subscription.schedule?.id ?? null);
      if (scheduleId) {
        if (deferToPeriodEnd) {
          return billingError("plan_change_scheduled");
        }
        // Releasing drops the customer's queued choice even if they abandon
        // Stripe. Require an explicit confirmation tied to the current schedule.
        if (form.get("replace_schedule") !== scheduleId) {
          return billingError("trial_change_scheduled", {
            plan: targetPlan,
            schedule: scheduleId,
          });
        }
      }

      const configuration = await getPlanSwitchPortalConfigurationId(stripe, {
        deferToPeriodEnd,
      });
      if (scheduleId) {
        await stripe.subscriptionSchedules.release(scheduleId, { preserve_cancel_date: true });
        releasedSchedule = scheduleId;
        // Record this mutation before session creation, which can still fail.
        await recordAudit({
          action: "billing.subscription_updated",
          resourceType: "subscription",
          resourceId: row.stripeSubscriptionId,
          firmId: orgId,
          metadata: {
            flow: "plan_switch_schedule_released",
            released_schedule: scheduleId,
            from_plan: currentPlan,
            to_plan: targetPlan,
          },
        });
      }
      // A deferred switch leaves the cycle on screen unchanged until the paid
      // period runs out, so the page has to greet them with that and not with
      // a confirmation that nothing on the page will bear out.
      const returnUrl = `${appOrigin()}/settings/billing?plan_changed=${
        deferToPeriodEnd ? "scheduled" : "1"
      }`;
      sessionParams = {
        ...sessionParams,
        ...(releasedSchedule ? {
          return_url: `${appOrigin()}/settings/billing?billing_error=plan_change_incomplete`,
        } : {}),
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
            released_schedule: releasedSchedule,
          }
        : { flow: "portal_home" },
    });
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("[billing/portal] stripe error:", err);
    return billingError(releasedSchedule ? "plan_change_incomplete" : "portal_unavailable");
  }
}
