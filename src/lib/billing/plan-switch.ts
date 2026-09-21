import type Stripe from "stripe";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
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
