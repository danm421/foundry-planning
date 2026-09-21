import type Stripe from "stripe";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getStripe } from "./stripe-client";
import { getPriceCatalog } from "./price-catalog";
import { billingPlanForPriceId, type BillingPlan } from "./billing-plan";
import {
  previewPlanSwitch,
  type PlanSwitchPreview,
  type PlanSwitchSubject,
} from "./plan-switch-preview";

/**
 * Billing-cycle switching, owned by the app rather than by Stripe's hosted
 * portal.
 *
 * The portal cannot do this correctly. Its
 * `features.subscription_update.schedule_at_period_end.conditions` are INERT
 * inside a `flow_data type=subscription_update_confirm` session — they read
 * back from Stripe as present and change nothing. The portal times a switch
 * off `proration_behavior` instead, so a paid annual -> monthly applies
 * immediately and bins the remaining paid months with no credit (measured
 * 2026-09-21: a $1,990 annual subscription re-anchored from 2027-09-21 to
 * 2026-10-21, $1,791 of paid service destroyed). `create_prorations` is not a
 * remedy either — it credits the downgrade and charges $3,781 today on the
 * upgrade. The flow accepts only `subscription`, `items` and `discounts`, so
 * no configuration fixes it.
 *
 * So the app builds the schedule itself. Do not re-add those conditions.
 */
export type PlanSwitchState =
  | { kind: "none"; currentPlan: BillingPlan }
  | {
      kind: "pending";
      currentPlan: BillingPlan;
      targetPlan: BillingPlan;
      effectiveAt: Date;
      scheduleId: string;
    }
  | { kind: "unavailable" };

type Subject = {
  subscription: Stripe.Subscription;
  seatItem: Stripe.SubscriptionItem;
  currentPlan: BillingPlan;
  schedule: Stripe.SubscriptionSchedule | null;
  view: PlanSwitchSubject;
};

function priceIdOf(price: string | { id: string }): string {
  return typeof price === "string" ? price : price.id;
}

/**
 * The phase that has not started yet — the pending change. A schedule whose
 * future phase has already landed still owns the subscription until it
 * releases, and that is NOT a pending change: offering "cancel" for it would
 * promise to undo something already applied.
 */
export function futurePhaseOf(
  schedule: Stripe.SubscriptionSchedule | null,
  nowSeconds: number,
): Stripe.SubscriptionSchedule.Phase | null {
  if (!schedule) return null;
  return schedule.phases.find((phase) => phase.start_date > nowSeconds) ?? null;
}

async function loadSubject(firmId: string): Promise<Subject | null> {
  const row = await db
    .select({
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      stripeCustomerId: subscriptions.stripeCustomerId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId))
    .orderBy(desc(subscriptions.createdAt))
    .then((r) => r[0]);
  if (!row) return null;

  const stripe = getStripe();
  const subscription = (await stripe.subscriptions.retrieve(row.stripeSubscriptionId, {
    expand: ["items.data.price", "schedule"],
  })) as unknown as Stripe.Subscription;

  const seatItem = subscription.items.data.find(
    (item) => billingPlanForPriceId(priceIdOf(item.price)) !== null,
  );
  if (!seatItem) return null;
  const currentPlan = billingPlanForPriceId(priceIdOf(seatItem.price));
  if (!currentPlan) return null;

  const schedule =
    subscription.schedule && typeof subscription.schedule !== "string"
      ? (subscription.schedule as Stripe.SubscriptionSchedule)
      : null;

  // Stripe API v22 moved current_period_* off Subscription onto each item.
  const item = seatItem as Stripe.SubscriptionItem & {
    current_period_end?: number | null;
  };
  return {
    subscription,
    seatItem,
    currentPlan,
    schedule,
    view: {
      status: subscription.status,
      currentPlan,
      periodEnd: new Date((item.current_period_end ?? 0) * 1000),
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    },
  };
}

/**
 * What the billing page renders. Read straight from Stripe on every visit —
 * there is no mirror to drift, and a pending change stays visible until it
 * lands. When Stripe cannot be reached this returns `unavailable`; the page
 * says so and hides the switch control rather than guessing.
 */
export async function readPlanSwitchState(firmId: string): Promise<PlanSwitchState> {
  try {
    const subject = await loadSubject(firmId);
    if (!subject) return { kind: "unavailable" };

    const future = futurePhaseOf(subject.schedule, Math.floor(Date.now() / 1000));
    if (future && subject.schedule) {
      const targetPlan = billingPlanForPriceId(priceIdOf(future.items[0].price));
      if (targetPlan) {
        return {
          kind: "pending",
          currentPlan: subject.currentPlan,
          targetPlan,
          effectiveAt: new Date(future.start_date * 1000),
          scheduleId: subject.schedule.id,
        };
      }
    }
    return { kind: "none", currentPlan: subject.currentPlan };
  } catch (err) {
    console.error("[billing/plan-switch] could not read switch state:", err);
    return { kind: "unavailable" };
  }
}

/** What the confirm screen renders — the real date and amount, from Stripe. */
export async function readPlanSwitchPreview(
  firmId: string,
  targetPlan: BillingPlan,
): Promise<
  | { ok: true; preview: PlanSwitchPreview }
  | { ok: false; reason: "unavailable" | "already_on_plan" | "pending_exists" }
> {
  try {
    const subject = await loadSubject(firmId);
    if (!subject) return { ok: false, reason: "unavailable" };
    if (subject.currentPlan === targetPlan) return { ok: false, reason: "already_on_plan" };
    if (futurePhaseOf(subject.schedule, Math.floor(Date.now() / 1000))) {
      return { ok: false, reason: "pending_exists" };
    }
    const catalog = getPriceCatalog();
    const stripe = getStripe();
    const price = await stripe.prices.retrieve(
      targetPlan === "monthly" ? catalog.seatMonthly : catalog.seatAnnual,
    );
    return {
      ok: true,
      preview: previewPlanSwitch(subject.view, {
        plan: targetPlan,
        unitAmount: price.unit_amount ?? 0,
        currency: price.currency,
      }),
    };
  } catch (err) {
    console.error("[billing/plan-switch] could not read preview:", err);
    return { ok: false, reason: "unavailable" };
  }
}

export type PlanSwitchResult =
  | { ok: true; mode: "scheduled"; plan: BillingPlan; effectiveAt: Date; scheduleId: string }
  | { ok: true; mode: "immediate"; plan: BillingPlan; effectiveAt: Date | null }
  | {
      ok: false;
      reason: "unavailable" | "already_on_plan" | "pending_exists" | "not_switchable";
    };

/**
 * Apply a cycle change. Paid subscribers get an app-owned schedule so the paid
 * period finishes first; trials get a direct item swap because they have paid
 * for nothing and `trial_end` is left untouched.
 *
 * Both branches re-read from Stripe and report what Stripe says. Nothing here
 * returns or audits the request that was sent — that is exactly the bug this
 * replaces, where the copy said "at the end of the period you have already
 * paid for" while the price had already moved.
 */
export async function commitPlanSwitch(
  firmId: string,
  targetPlan: BillingPlan,
): Promise<PlanSwitchResult> {
  try {
    const subject = await loadSubject(firmId);
    if (!subject) return { ok: false, reason: "unavailable" };
    if (subject.currentPlan === targetPlan) return { ok: false, reason: "already_on_plan" };
    if (
      !["trialing", "active"].includes(subject.subscription.status) ||
      subject.subscription.cancel_at_period_end ||
      subject.subscription.cancel_at
    ) {
      return { ok: false, reason: "not_switchable" };
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (futurePhaseOf(subject.schedule, nowSeconds)) {
      return { ok: false, reason: "pending_exists" };
    }

    const stripe = getStripe();
    const catalog = getPriceCatalog();
    const targetPriceId = targetPlan === "monthly" ? catalog.seatMonthly : catalog.seatAnnual;
    const targetPrice = await stripe.prices.retrieve(targetPriceId);
    const quantity = subject.seatItem.quantity ?? 1;

    if (subject.subscription.status === "trialing") {
      const updated = await stripe.subscriptions.update(subject.subscription.id, {
        items: [{ id: subject.seatItem.id, price: targetPriceId, quantity }],
        proration_behavior: "none",
      });
      const landedPlan = billingPlanForPriceId(priceIdOf(updated.items.data[0].price));
      const firstBill = updated.trial_end ? new Date(updated.trial_end * 1000) : null;
      await recordAudit({
        action: "billing.subscription_updated",
        resourceType: "subscription",
        resourceId: subject.subscription.id,
        firmId,
        metadata: {
          flow: "plan_switch_immediate",
          from_plan: subject.currentPlan,
          to_plan: landedPlan,
          effective_at: firstBill?.toISOString() ?? null,
        },
      });
      return {
        ok: true,
        mode: "immediate",
        plan: landedPlan ?? targetPlan,
        effectiveAt: firstBill,
      };
    }

    // A schedule whose future phase already landed still owns the subscription.
    // Releasing it is free and lossless (measured), and it is the only way to
    // build a fresh one.
    if (subject.schedule) {
      await stripe.subscriptionSchedules.release(subject.schedule.id);
    }

    const created = await stripe.subscriptionSchedules.create({
      from_subscription: subject.subscription.id,
    });
    const running = created.phases[0];
    const landed = await stripe.subscriptionSchedules.update(created.id, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          items: running.items.map((item) => ({
            price: priceIdOf(item.price as string | { id: string }),
            quantity: item.quantity ?? 1,
          })),
          start_date: running.start_date,
          end_date: running.end_date,
        },
        {
          items: [{ price: targetPriceId, quantity }],
          // NOT `iterations` — removed from schedule phases; passing it returns
          // "Received unknown parameter: phases[iterations]".
          duration: {
            interval: targetPrice.recurring?.interval ?? "month",
            interval_count: targetPrice.recurring?.interval_count ?? 1,
          },
        },
      ],
    });

    const future = futurePhaseOf(landed, nowSeconds);
    if (!future) {
      console.error("[billing/plan-switch] schedule created without a future phase", landed.id);
      return { ok: false, reason: "unavailable" };
    }
    const landedPlan = billingPlanForPriceId(priceIdOf(future.items[0].price));
    const effectiveAt = new Date(future.start_date * 1000);
    await recordAudit({
      action: "billing.subscription_updated",
      resourceType: "subscription",
      resourceId: subject.subscription.id,
      firmId,
      metadata: {
        flow: "plan_switch_scheduled",
        from_plan: subject.currentPlan,
        to_plan: landedPlan,
        effective_at: effectiveAt.toISOString(),
        schedule_id: landed.id,
      },
    });
    return {
      ok: true,
      mode: "scheduled",
      plan: landedPlan ?? targetPlan,
      effectiveAt,
      scheduleId: landed.id,
    };
  } catch (err) {
    console.error("[billing/plan-switch] could not commit switch:", err);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Undo a pending change. Releasing a schedule on a paid subscription is free
 * and restores the status quo exactly — measured: price, period and invoices
 * unchanged, $0 moved. "Contact support" was our own policy, never Stripe's.
 *
 * The release is confirmed by re-reading the subscription, because a release
 * that silently failed would leave the page telling them it is gone.
 */
export async function cancelPendingPlanSwitch(firmId: string): Promise<{ ok: boolean }> {
  try {
    const subject = await loadSubject(firmId);
    if (!subject) return { ok: false };
    const future = futurePhaseOf(subject.schedule, Math.floor(Date.now() / 1000));
    if (!future || !subject.schedule) return { ok: true };

    const scheduleId = subject.schedule.id;
    const targetPlan = billingPlanForPriceId(priceIdOf(future.items[0].price));
    await getStripe().subscriptionSchedules.release(scheduleId);

    const after = await loadSubject(firmId);
    if (!after) return { ok: false };
    if (futurePhaseOf(after.schedule, Math.floor(Date.now() / 1000))) return { ok: false };

    await recordAudit({
      action: "billing.subscription_updated",
      resourceType: "subscription",
      resourceId: subject.subscription.id,
      firmId,
      metadata: {
        flow: "plan_switch_canceled",
        released_schedule: scheduleId,
        from_plan: subject.currentPlan,
        to_plan: targetPlan,
      },
    });
    return { ok: true };
  } catch (err) {
    console.error("[billing/plan-switch] could not cancel pending switch:", err);
    return { ok: false };
  }
}
