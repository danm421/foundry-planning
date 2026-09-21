import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import { ForbiddenError, requireBillingContact } from "@/lib/authz";
import { readPlanSwitchPreview } from "@/lib/billing/plan-switch";
import {
  planSwitchCopy,
  formatPlanAmount,
  formatPlanDate,
} from "@/lib/billing/plan-switch-preview";
import type { BillingPlan } from "@/lib/billing/billing-plan";
import Forbidden from "../../forbidden";
import { confirmPlanSwitchAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * The confirm screen for a billing-cycle change.
 *
 * This used to be Stripe's hosted portal. It cannot be: the portal applies a
 * paid downgrade immediately and bins the remaining paid months, and its
 * confirm copy describes a proration that does not happen here. Nothing is due
 * today on any switch, so there is no payment to collect and no reason to
 * leave the app.
 *
 * Every number on this page comes from a live Stripe read — see
 * `readPlanSwitchPreview`. Nothing here is computed from what the user asked
 * for.
 */
const REFUSALS: Record<string, string> = {
  unavailable:
    "We couldn't reach Stripe to check your subscription, so we haven't changed anything. Please try again in a moment.",
  already_on_plan: "You're already on that billing cycle.",
  pending_exists:
    "You already have a change scheduled. Cancel it on the billing page first if you want a different one.",
};

function Refusal({ message }: { message: string }): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div role="alert" className="rounded border border-crit bg-crit/10 p-4 text-sm text-crit">
        {message}
      </div>
      <a href="/settings/billing" className="btn-ghost min-h-11 w-fit px-3 text-sm">
        Back to billing
      </a>
    </div>
  );
}

export default async function PlanSwitchPage({
  searchParams,
}: {
  searchParams?: Promise<{ plan?: string | string[] }>;
}): Promise<ReactElement> {
  try {
    await requireBillingContact();
  } catch (err) {
    if (err instanceof ForbiddenError) return <Forbidden requiredRole="billing contact" />;
    throw err;
  }

  const sp = await searchParams;
  const raw = Array.isArray(sp?.plan) ? sp.plan[0] : sp?.plan;
  if (raw !== "monthly" && raw !== "annual") {
    return <Refusal message="That isn't a billing cycle we offer." />;
  }
  const plan: BillingPlan = raw;

  const { orgId } = await auth();
  if (!orgId) return <Refusal message={REFUSALS.unavailable} />;

  const result = await readPlanSwitchPreview(orgId, plan);
  if (!result.ok) return <Refusal message={REFUSALS[result.reason] ?? REFUSALS.unavailable} />;

  const { preview } = result;
  const copy = planSwitchCopy(preview);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-medium text-ink">Switch to {plan}</h1>
        <p className="text-sm text-ink-3">
          Confirm the change below. You can cancel it any time before it takes effect.
        </p>
      </header>

      <div className="flex flex-col gap-2 rounded border border-hair bg-card p-4 text-sm">
        <p className="text-ink">{copy.headline}</p>
        <p className="text-ink-2">{copy.detail}</p>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-4">
            {preview.mode === "immediate" ? "First bill" : "New price starts"}
          </dt>
          <dd className="tabular text-ink">{formatPlanDate(preview.effectiveAt)}</dd>
          <dt className="text-ink-4">New price</dt>
          <dd className="tabular text-ink">
            {formatPlanAmount(preview.unitAmount, preview.currency)}
          </dd>
          <dt className="text-ink-4">Due today</dt>
          <dd className="tabular text-ink">
            {formatPlanAmount(preview.dueToday, preview.currency)}
          </dd>
        </dl>
        <p className="text-ink-3">{copy.dueToday}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form action={confirmPlanSwitchAction}>
          <input type="hidden" name="plan" value={plan} />
          <button type="submit" className="btn-primary min-h-11 cursor-pointer px-3 text-sm">
            Switch to {plan}
          </button>
        </form>
        <a href="/settings/billing" className="btn-ghost min-h-11 px-3 text-sm">
          Go back
        </a>
      </div>
    </div>
  );
}
