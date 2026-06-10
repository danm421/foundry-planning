// src/lib/billing/auto-heal.ts
import type { DriftEntry } from "@/lib/billing/reconcile";

export type AutoHealPlan = {
  firmId: string;
  /** Partial Clerk org publicMetadata patch to apply. */
  patch: { subscription_status?: string; entitlements?: string[] };
  healedFields: Array<"status" | "entitlements">;
};

/**
 * From a firm's drift entries, decide what to write back to Clerk public
 * metadata. Stripe is source of truth, so we heal `status` and `entitlements`
 * with Stripe's value. `items` drift is left DETECT-ONLY (ambiguous — could be
 * a mid-flight Stripe item change the DB hasn't mirrored yet) per the spec;
 * ops resolves it manually. The cron's <error> status sentinel is never
 * healed (we don't have a real Stripe value to trust).
 *
 * Returns null when there is nothing safe to auto-heal.
 */
export function planAutoHeal(drift: DriftEntry[]): AutoHealPlan | null {
  if (drift.length === 0) return null;
  const firmId = drift[0].firmId;
  const patch: AutoHealPlan["patch"] = {};
  const healedFields: AutoHealPlan["healedFields"] = [];

  for (const d of drift) {
    if (d.field === "status" && typeof d.stripeValue === "string" && d.stripeValue !== "<error>") {
      patch.subscription_status = d.stripeValue;
      healedFields.push("status");
    } else if (d.field === "entitlements" && Array.isArray(d.stripeValue)) {
      patch.entitlements = d.stripeValue as string[];
      healedFields.push("entitlements");
    }
    // field === "items": detect-only, intentionally skipped.
  }

  if (healedFields.length === 0) return null;
  return { firmId, patch, healedFields };
}
