import type { BillingPlan } from "./billing-plan";

/**
 * Pure preview of a billing-cycle change. No Stripe, no DB — the caller has
 * already read the live subscription, and this turns it into the numbers and
 * the sentences the confirm screen shows.
 *
 * The one rule this file exists to enforce: a switch never costs anything
 * today, in either direction. A paid subscriber keeps the period they bought
 * and the new price starts when it ends; a trial has bought nothing, so the
 * price flips now and the trial end is untouched.
 */
export type PlanSwitchSubject = {
  status: string;
  currentPlan: BillingPlan;
  periodEnd: Date;
  trialEnd: Date | null;
};

export type PlanSwitchTarget = {
  plan: BillingPlan;
  unitAmount: number;
  currency: string;
};

export type PlanSwitchPreview = {
  mode: "scheduled" | "immediate";
  currentPlan: BillingPlan;
  plan: BillingPlan;
  /** When the new price starts applying. For a trial, the first bill date. */
  effectiveAt: Date;
  unitAmount: number;
  currency: string;
  dueToday: number;
};

export type PlanSwitchCopy = {
  headline: string;
  detail: string;
  dueToday: string;
};

const INTERVAL_WORD: Record<BillingPlan, string> = {
  monthly: "a month",
  annual: "a year",
};

/**
 * `locale` is threaded through rather than baked in so the copy tests can
 * assert exact sentences. Left undefined — the default everywhere in the app —
 * it formats in the reader's own locale, like the rest of the billing page.
 */
export function formatPlanAmount(
  cents: number,
  currency: string,
  locale?: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatPlanDate(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function previewPlanSwitch(
  subject: PlanSwitchSubject,
  target: PlanSwitchTarget,
): PlanSwitchPreview {
  const immediate = subject.status === "trialing";
  return {
    mode: immediate ? "immediate" : "scheduled",
    currentPlan: subject.currentPlan,
    plan: target.plan,
    effectiveAt: immediate ? (subject.trialEnd ?? subject.periodEnd) : subject.periodEnd,
    unitAmount: target.unitAmount,
    currency: target.currency,
    dueToday: 0,
  };
}

export function planSwitchCopy(
  preview: PlanSwitchPreview,
  locale?: string,
): PlanSwitchCopy {
  const amount = formatPlanAmount(preview.unitAmount, preview.currency, locale);
  const when = formatPlanDate(preview.effectiveAt, locale);
  if (preview.mode === "immediate") {
    return {
      headline: `Your plan changes to ${preview.plan} now.`,
      detail: `Your first bill is ${amount} on ${when}.`,
      dueToday: "Nothing is due today.",
    };
  }
  return {
    headline: `You stay on ${preview.currentPlan} until ${when}.`,
    detail: `From then you'll be billed ${amount} ${INTERVAL_WORD[preview.plan]}.`,
    dueToday: "Nothing is due today.",
  };
}
