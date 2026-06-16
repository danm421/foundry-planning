import { deriveEntitlements, type EntitlementOverride } from "./entitlements";

export type ReconcileItem = {
  kind: "seat" | "addon";
  addonKey: string | null;
  quantity: number;
  removed: boolean;
};

export type ReconcileInput = {
  firmId: string;
  stripe: { status: string; items: ReconcileItem[] };
  db: { status: string; items: ReconcileItem[] };
  clerk: { subscriptionStatus: string; entitlements: string[] };
  /** Active manual overrides for this firm; unioned into the derived
   *  entitlements so a grant survives reconciliation (and a revoke is honored). */
  overrides?: EntitlementOverride[];
};

export type DriftEntry = {
  firmId: string;
  field: "status" | "items" | "entitlements";
  stripeValue: unknown;
  dbValue?: unknown;
  clerkValue: unknown;
};

/**
 * Pure-function comparison of Stripe live state vs DB mirror vs Clerk hot-path
 * metadata. Returns an array of drift entries — empty when all three agree.
 * Used by the reconciliation cron; tests can table-drive every drift shape.
 *
 * "Stripe is source of truth": when Stripe disagrees with DB or Clerk, the
 * drift is flagged with Stripe's value as the reference. Auto-heal is NOT
 * implemented here — the cron only detects, ops resolves manually per
 * runbook.
 *
 * Entitlements are derived from the Stripe line items (an active seat implies
 * the bundled `ai_import`), then any active manual `overrides` are unioned in
 * as a final step — a grant adds a key the subscription doesn't imply, a revoke
 * strips one (even the seat-included `ai_import`). Drift checks compare that
 * derivation against the Clerk hot-path snapshot, so a manual grant is not
 * flagged as drift and clobbered on heal.
 */
export function diffReconciliation(input: ReconcileInput): DriftEntry[] {
  const drift: DriftEntry[] = [];
  const { firmId, stripe, db, clerk } = input;

  if (stripe.status !== db.status || stripe.status !== clerk.subscriptionStatus) {
    drift.push({
      firmId,
      field: "status",
      stripeValue: stripe.status,
      dbValue: db.status,
      clerkValue: clerk.subscriptionStatus,
    });
  }

  const norm = (items: ReconcileItem[]) =>
    items
      .filter((i) => !i.removed)
      .map((i) => ({ kind: i.kind, addonKey: i.addonKey, quantity: i.quantity }))
      .sort((a, b) =>
        `${a.kind}:${a.addonKey}`.localeCompare(`${b.kind}:${b.addonKey}`),
      );
  const stripeItems = norm(stripe.items);
  const dbItems = norm(db.items);
  if (JSON.stringify(stripeItems) !== JSON.stringify(dbItems)) {
    drift.push({
      firmId,
      field: "items",
      stripeValue: stripeItems,
      dbValue: dbItems,
      clerkValue: clerk.entitlements,
    });
  }

  const derived = deriveEntitlements({ items: stripe.items, overrides: input.overrides ?? [] });
  const clerkSorted = [...clerk.entitlements].sort();
  if (JSON.stringify(derived) !== JSON.stringify(clerkSorted)) {
    drift.push({
      firmId,
      field: "entitlements",
      stripeValue: derived,
      clerkValue: clerkSorted,
    });
  }

  return drift;
}
