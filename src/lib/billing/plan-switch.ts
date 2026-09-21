import type Stripe from "stripe";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { getStripe } from "./stripe-client";
import { getPriceCatalog } from "./price-catalog";
import { billingPlanForPriceId, type BillingPlan } from "./billing-plan";
import {
  planSwitchMode,
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
  schedule: Stripe.SubscriptionSchedule | null;
  /** The only copy of the current plan and period — see `view.currentPlan`. */
  view: PlanSwitchSubject;
};

function priceIdOf(price: string | { id: string }): string {
  return typeof price === "string" ? price : price.id;
}

/** Stripe's clock, in the epoch seconds every field here is expressed in. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * The seat item, found by catalog predicate rather than by position. Item order
 * is not a Stripe contract, and a subscription may legitimately carry more than
 * one recurring item (an add-on), so `items[0]` is only ever right by accident.
 */
function seatItemOf<T extends { price: string | { id: string } }>(
  items: T[],
): T | undefined {
  return items.find((item) => billingPlanForPriceId(priceIdOf(item.price)) !== null);
}

/** The plan a set of items resolves to, or null when we cannot name it. */
function seatPlanOf(items: Array<{ price: string | { id: string } }>): BillingPlan | null {
  const seat = seatItemOf(items);
  return seat ? billingPlanForPriceId(priceIdOf(seat.price)) : null;
}

/**
 * Stripe replaces the whole `phases` array on every update, so the running
 * phase has to be handed back. Converting it in ONE place keeps the knowledge
 * of a phase's shape from being hand-copied at each call site — the same class
 * of coupling that made `iterations` -> `duration` a runtime 400 rather than a
 * type error.
 */
function phaseToParams(
  phase: Stripe.SubscriptionSchedule.Phase,
): Stripe.SubscriptionScheduleUpdateParams.Phase {
  return {
    items: phase.items.map((item) => ({
      price: priceIdOf(item.price as string | { id: string }),
      quantity: item.quantity ?? 1,
    })),
    start_date: phase.start_date,
    end_date: phase.end_date,
  };
}

/**
 * The phase that has not started yet — the pending change. A schedule whose
 * future phase has already landed still owns the subscription until it
 * releases, and that is NOT a pending change: offering "cancel" for it would
 * promise to undo something already applied.
 */
export function futurePhaseOf(
  schedule: Stripe.SubscriptionSchedule | null,
  now: number,
): Stripe.SubscriptionSchedule.Phase | null {
  if (!schedule) return null;
  return schedule.phases.find((phase) => phase.start_date > now) ?? null;
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

  const seatItem = seatItemOf(subscription.items.data);
  if (!seatItem) return null;
  const currentPlan = billingPlanForPriceId(priceIdOf(seatItem.price));
  if (!currentPlan) return null;

  const schedule =
    subscription.schedule && typeof subscription.schedule !== "string"
      ? (subscription.schedule as Stripe.SubscriptionSchedule)
      : null;

  // Stripe API v22 moved current_period_* off Subscription onto each item.
  // No default: a missing period end must refuse, not resolve to the epoch.
  // Every screen here states a date, so inventing one would print "You stay on
  // annual until Jan 1, 1970" — a date Stripe never confirmed, which is the
  // exact failure this module exists to prevent.
  const item = seatItem as Stripe.SubscriptionItem & {
    current_period_end?: number | null;
  };
  if (!item.current_period_end) {
    console.error("[billing/plan-switch] seat item has no current_period_end", subscription.id);
    return null;
  }

  return {
    subscription,
    seatItem,
    schedule,
    view: {
      status: subscription.status,
      currentPlan,
      periodEnd: new Date(item.current_period_end * 1000),
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

    const future = futurePhaseOf(subject.schedule, nowSeconds());
    if (future && subject.schedule) {
      const targetPlan = seatPlanOf(future.items);
      if (targetPlan) {
        return {
          kind: "pending",
          currentPlan: subject.view.currentPlan,
          targetPlan,
          effectiveAt: new Date(future.start_date * 1000),
          scheduleId: subject.schedule.id,
        };
      }
    }
    return { kind: "none", currentPlan: subject.view.currentPlan };
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
    if (subject.view.currentPlan === targetPlan) return { ok: false, reason: "already_on_plan" };
    if (futurePhaseOf(subject.schedule, nowSeconds())) {
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
/**
 * A trial has paid for nothing, so the price flips now and `trial_end` is left
 * untouched — measured: still trialing, trial end held, $0 billed.
 */
async function commitTrialSwitch(
  subject: Subject,
  firmId: string,
  targetPriceId: string,
): Promise<PlanSwitchResult> {
  const updated = await getStripe().subscriptions.update(subject.subscription.id, {
    items: [
      { id: subject.seatItem.id, price: targetPriceId, quantity: subject.seatItem.quantity ?? 1 },
    ],
    proration_behavior: "none",
  });
  const landedPlan = seatPlanOf(updated.items.data);
  if (!landedPlan) {
    console.error("[billing/plan-switch] trial landed on an unrecognised price", updated.id);
    return { ok: false, reason: "unavailable" };
  }
  const firstBill = updated.trial_end ? new Date(updated.trial_end * 1000) : null;
  await recordAudit({
    action: "billing.subscription_updated",
    resourceType: "subscription",
    resourceId: subject.subscription.id,
    firmId,
    metadata: {
      flow: "plan_switch_immediate",
      from_plan: subject.view.currentPlan,
      to_plan: landedPlan,
      effective_at: firstBill?.toISOString() ?? null,
    },
  });
  return { ok: true, mode: "immediate", plan: landedPlan, effectiveAt: firstBill };
}

/**
 * A paid subscriber keeps the period they bought: the running phase is handed
 * back exactly as Stripe reported it, and a second phase at the target price
 * starts when it ends. `end_behavior: "release"` hands the subscription back
 * once the new price lands.
 */
async function commitScheduledSwitch(
  subject: Subject,
  firmId: string,
  targetPriceId: string,
  recurring: Stripe.Price.Recurring,
): Promise<PlanSwitchResult> {
  const stripe = getStripe();

  // A schedule whose future phase already landed still owns the subscription.
  // Releasing it is free and lossless (measured), and it is the only way to
  // build a fresh one.
  if (subject.schedule) {
    await stripe.subscriptionSchedules.release(subject.schedule.id);
  }

  const created = await stripe.subscriptionSchedules.create({
    from_subscription: subject.subscription.id,
  });
  const running = phaseToParams(created.phases[0]);
  const currentSeatPriceId = priceIdOf(subject.seatItem.price);
  const next = {
    // Built by SWAPPING the seat price inside the running phase's items, not
    // from scratch: a subscription may carry an add-on alongside the seat, and
    // listing only the seat here would silently drop it when the phase lands.
    items: running.items.map((item) =>
      item.price === currentSeatPriceId ? { ...item, price: targetPriceId } : item,
    ),
    // NOT `iterations` — removed from schedule phases; passing it returns
    // "Received unknown parameter: phases[iterations]".
    duration: { interval: recurring.interval, interval_count: recurring.interval_count ?? 1 },
  };

  const landed = await stripe.subscriptionSchedules.update(created.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [running, next],
  });

  const future = futurePhaseOf(landed, nowSeconds());
  if (!future) {
    console.error("[billing/plan-switch] schedule created without a future phase", landed.id);
    return { ok: false, reason: "unavailable" };
  }
  const landedPlan = seatPlanOf(future.items);
  if (!landedPlan) {
    console.error("[billing/plan-switch] scheduled phase carries an unrecognised price", landed.id);
    return { ok: false, reason: "unavailable" };
  }
  const effectiveAt = new Date(future.start_date * 1000);
  await recordAudit({
    action: "billing.subscription_updated",
    resourceType: "subscription",
    resourceId: subject.subscription.id,
    firmId,
    metadata: {
      flow: "plan_switch_scheduled",
      from_plan: subject.view.currentPlan,
      to_plan: landedPlan,
      effective_at: effectiveAt.toISOString(),
      schedule_id: landed.id,
    },
  });
  return { ok: true, mode: "scheduled", plan: landedPlan, effectiveAt, scheduleId: landed.id };
}

export async function commitPlanSwitch(
  firmId: string,
  targetPlan: BillingPlan,
): Promise<PlanSwitchResult> {
  try {
    const subject = await loadSubject(firmId);
    if (!subject) return { ok: false, reason: "unavailable" };
    if (subject.view.currentPlan === targetPlan) return { ok: false, reason: "already_on_plan" };
    if (
      !["trialing", "active"].includes(subject.subscription.status) ||
      subject.subscription.cancel_at_period_end ||
      subject.subscription.cancel_at
    ) {
      return { ok: false, reason: "not_switchable" };
    }
    if (futurePhaseOf(subject.schedule, nowSeconds())) {
      return { ok: false, reason: "pending_exists" };
    }

    const catalog = getPriceCatalog();
    const targetPriceId = targetPlan === "monthly" ? catalog.seatMonthly : catalog.seatAnnual;
    const targetPrice = await getStripe().prices.retrieve(targetPriceId);
    if (!targetPrice.recurring) {
      console.error("[billing/plan-switch] target price has no recurring interval", targetPriceId);
      return { ok: false, reason: "unavailable" };
    }

    // Branch on the SAME rule the confirm screen promised, not a second copy
    // of it — see `planSwitchMode`.
    return planSwitchMode(subject.view) === "immediate"
      ? await commitTrialSwitch(subject, firmId, targetPriceId)
      : await commitScheduledSwitch(subject, firmId, targetPriceId, targetPrice.recurring);
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
    const future = futurePhaseOf(subject.schedule, nowSeconds());
    if (!future || !subject.schedule) return { ok: true };

    const scheduleId = subject.schedule.id;
    const targetPlan = seatPlanOf(future.items);
    await getStripe().subscriptionSchedules.release(scheduleId);

    const after = await loadSubject(firmId);
    if (!after) return { ok: false };
    if (futurePhaseOf(after.schedule, nowSeconds())) return { ok: false };

    await recordAudit({
      action: "billing.subscription_updated",
      resourceType: "subscription",
      resourceId: subject.subscription.id,
      firmId,
      metadata: {
        flow: "plan_switch_canceled",
        released_schedule: scheduleId,
        from_plan: subject.view.currentPlan,
        to_plan: targetPlan,
      },
    });
    return { ok: true };
  } catch (err) {
    console.error("[billing/plan-switch] could not cancel pending switch:", err);
    return { ok: false };
  }
}
