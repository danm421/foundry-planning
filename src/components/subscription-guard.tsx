import type { ReactElement } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import type { SubscriptionState } from "@/lib/billing/subscription-state";
import SubscriptionBannerDismiss from "./subscription-banner-dismiss";

const DISMISS_COOKIE = "sub-banner-dismissed";

interface Props {
  state: SubscriptionState;
  isFounder: boolean;
  preview?: { kind?: string; date?: string };
}

type Banner = {
  severity: "info-yellow" | "info-gray" | "urgent-red";
  message: ReactElement | string;
  actionHref?: string;
  actionLabel?: string;
  dismissible: boolean;
  dismissKey: string;
};

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function bannerFor(state: SubscriptionState): Banner | null {
  switch (state.kind) {
    case "founder":
    case "active":
      return null;
    case "trialing":
      return {
        severity: "info-yellow",
        message: `Trial ends ${fmt(state.trialEndsAt)}. Add a payment method to keep going.`,
        actionHref: "/settings/billing",
        actionLabel: "Add payment method",
        dismissible: true,
        dismissKey: `trialing:${state.trialEndsAt.toISOString()}`,
      };
    case "active_canceling":
      return {
        severity: "info-gray",
        message: `Subscription ends ${fmt(state.periodEnd)}. Reactivate anytime in billing.`,
        actionHref: "/settings/billing",
        actionLabel: "Reactivate",
        dismissible: true,
        dismissKey: `active_canceling:${state.periodEnd.toISOString()}`,
      };
    case "past_due":
      return {
        severity: "urgent-red",
        message: "Payment failed — update your card to avoid interruption.",
        actionHref: "/settings/billing",
        actionLabel: "Update card",
        dismissible: false,
        dismissKey: "past_due:persistent",
      };
    case "canceled_grace": {
      const graceUntil = new Date(state.archivedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      return {
        severity: "urgent-red",
        message: `Subscription canceled. Read-only access until ${fmt(graceUntil)}. Reactivate to restore editing.`,
        actionHref: "/settings/billing",
        actionLabel: "Reactivate",
        dismissible: false,
        dismissKey: "canceled_grace:persistent",
      };
    }
    case "canceled_locked":
      return {
        severity: "urgent-red",
        message: "Account locked. Reactivate billing to restore access.",
        actionHref: "/settings/billing",
        actionLabel: "Reactivate",
        dismissible: false,
        dismissKey: "canceled_locked:persistent",
      };
    case "missing":
      return {
        severity: "info-yellow",
        message: "Couldn't read subscription state — try refreshing or contact support.",
        dismissible: false,
        dismissKey: "missing:persistent",
      };
  }
}

const PREVIEW_STATES: Record<string, (date?: string) => SubscriptionState> = {
  founder: () => ({ kind: "founder" }),
  active: () => ({ kind: "active" }),
  trialing: (date) => ({
    kind: "trialing",
    trialEndsAt: new Date(date ?? "2026-05-15"),
  }),
  active_canceling: (date) => ({
    kind: "active_canceling",
    periodEnd: new Date(date ?? "2026-06-01"),
  }),
  past_due: () => ({ kind: "past_due" }),
  canceled_grace: (date) => ({
    kind: "canceled_grace",
    archivedAt: new Date(date ?? new Date()),
    mutationsAllowed: false,
  }),
  canceled_locked: () => ({ kind: "canceled_locked" }),
  missing: () => ({ kind: "missing", reason: "no_metadata" }),
};

const SEVERITY_CLASS: Record<Banner["severity"], string> = {
  "info-yellow": "bg-warn/10 text-warn border-warn/30",
  "info-gray": "bg-paper text-ink-2 border-hair",
  "urgent-red": "bg-crit/10 text-crit border-crit/30",
};

const SEVERITY_ROLE: Record<Banner["severity"], "alert" | "status"> = {
  "info-yellow": "status",
  "info-gray": "status",
  "urgent-red": "alert",
};

export async function SubscriptionGuard({
  state,
  isFounder,
  preview,
}: Props): Promise<ReactElement | null> {
  // Founder-only preview override
  let effective = state;
  if (isFounder && preview?.kind && PREVIEW_STATES[preview.kind]) {
    effective = PREVIEW_STATES[preview.kind](preview.date);
  }

  const banner = bannerFor(effective);
  if (!banner) return null;

  // Dismissal short-circuit (info-severity only)
  if (banner.dismissible) {
    const jar = await cookies();
    const cookie = jar.get(DISMISS_COOKIE)?.value;
    if (cookie === banner.dismissKey) return null;
  }

  return (
    <div
      role={SEVERITY_ROLE[banner.severity]}
      className={`flex items-center gap-3 rounded border px-4 py-2 text-sm ${SEVERITY_CLASS[banner.severity]}`}
    >
      <span className="sr-only">{banner.severity === "urgent-red" ? "Action required:" : "Notice:"}</span>
      <span className="flex-1">{banner.message}</span>
      {banner.actionHref && banner.actionLabel ? (
        <Link href={banner.actionHref} className="font-medium underline">
          {banner.actionLabel}
        </Link>
      ) : null}
      {banner.dismissible ? (
        <SubscriptionBannerDismiss dismissKey={banner.dismissKey} />
      ) : null}
    </div>
  );
}
