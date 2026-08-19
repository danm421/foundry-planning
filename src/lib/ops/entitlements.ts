import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  opsEntitlementOverrides,
  opsUserEntitlementOverrides,
  subscriptions,
  subscriptionItems,
} from "@/db/schema";
import {
  deriveEntitlements,
  CLIENT_PORTAL_ENTITLEMENT,
  type EntitlementOverride,
  type StripeItemView,
} from "@/lib/billing/entitlements";
import { recordAudit } from "@/lib/audit";
import { collapseActiveOverrides, type ActiveOverride } from "@/lib/entitlements/overrides";

// Re-exported from their new pure home so importers of this module — including
// `ops/__tests__/entitlements.test.ts` — are unaffected by the move.
export { collapseActiveOverrides } from "@/lib/entitlements/overrides";
export type { OverrideRow, ActiveOverride } from "@/lib/entitlements/overrides";

/** Capability keys the Entitlements tab can toggle (label/description drive the
 *  UI). The AI keys are base entitlements — on everywhere, so an override here
 *  is a per-firm kill switch. `client_portal` is the inverse: off everywhere, so
 *  a grant here is the only way to turn it on for a firm. */
export type CapabilityKey = {
  key: string;
  label: string;
  description: string;
  /** True when ops can also aim this key at a SINGLE user inside the firm.
   *  Only the client portal today — the storage and the resolution take any
   *  key, so widening later is this flag and nothing else. */
  perUser?: boolean;
};
export const CAPABILITY_KEYS: CapabilityKey[] = [
  {
    key: "ai_import",
    label: "AI document import",
    description: "Extract client data from uploaded documents via AI.",
  },
  {
    key: "ai_forge",
    label: "Forge (AI planning assistant)",
    description: "Conversational planning assistant powered by AI agents.",
  },
  {
    key: CLIENT_PORTAL_ENTITLEMENT,
    label: "Client portal",
    description:
      "Off by default. Grant to let this firm invite clients to the portal; revoking locks out clients already using it.",
    perUser: true,
  },
];

const LIVE_SUB_STATUSES = ["trialing", "active", "past_due", "unpaid", "paused"];

/** Load + collapse a firm's active overrides (full rows, for the UI). */
export async function getActiveOverrides(firmId: string): Promise<ActiveOverride[]> {
  const rows = await db
    .select({
      entitlement: opsEntitlementOverrides.entitlement,
      mode: opsEntitlementOverrides.mode,
      reason: opsEntitlementOverrides.reason,
      setBy: opsEntitlementOverrides.setBy,
      expiresAt: opsEntitlementOverrides.expiresAt,
      createdAt: opsEntitlementOverrides.createdAt,
    })
    .from(opsEntitlementOverrides)
    .where(eq(opsEntitlementOverrides.firmId, firmId))
    .orderBy(opsEntitlementOverrides.createdAt);
  return collapseActiveOverrides(rows, new Date());
}

/** Reduced form for the pure deriveEntitlements (the reconcile + webhook paths). */
export async function getActiveEntitlementOverrides(
  firmId: string,
): Promise<EntitlementOverride[]> {
  return (await getActiveOverrides(firmId)).map((o) => ({
    entitlement: o.entitlement,
    mode: o.mode,
  }));
}

/** A firm's live-subscription line items as StripeItemView[] (or [] for founders
 *  / no live sub). Mirrors the reconcile cron's live-status selection. */
async function loadFirmItemViews(firmId: string): Promise<StripeItemView[]> {
  const subRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId));
  const liveSub = subRows.find((s) => LIVE_SUB_STATUSES.includes(s.status));
  if (!liveSub) return [];
  const items = await db
    .select()
    .from(subscriptionItems)
    .where(eq(subscriptionItems.subscriptionId, liveSub.id));
  return items.map((r) => ({
    kind: r.kind as "seat" | "addon",
    addonKey: r.addonKey,
    removed: r.removedAt !== null,
  }));
}

/** Read-only: the effective entitlements for a firm (items ∪ active overrides). */
export async function computeFirmEntitlements(firmId: string): Promise<string[]> {
  const [items, overrides] = await Promise.all([
    loadFirmItemViews(firmId),
    getActiveEntitlementOverrides(firmId),
  ]);
  return deriveEntitlements({ items, overrides });
}

/** Recompute + write the firm's entitlements to Clerk (the derived cache). */
export async function writeFirmEntitlements(firmId: string): Promise<string[]> {
  const entitlements = await computeFirmEntitlements(firmId);
  const cc = await clerkClient();
  // Shallow PATCH — only `entitlements` is touched; other publicMetadata keys
  // (subscription_status, trial_ends_at, …) are preserved by Clerk.
  await cc.organizations.updateOrganizationMetadata(firmId, {
    publicMetadata: { entitlements },
  });
  return entitlements;
}

/** Append a manual override, refresh the Clerk cache, and audit it. */
export async function setEntitlementOverride(args: {
  firmId: string;
  entitlement: string;
  mode: "grant" | "revoke";
  reason: string;
  setBy: string; // ops clerk_user_id (from requireOpsAdmin)
}): Promise<string[]> {
  const { firmId, entitlement, mode, reason, setBy } = args;
  // Not transactional by design: the override row is the durable source of
  // truth. If the Clerk write or audit fails after the insert, the override
  // still holds and the reconcile-billing cron re-syncs the Clerk cache.
  await db
    .insert(opsEntitlementOverrides)
    .values({ firmId, entitlement, mode, reason, setBy });
  const entitlements = await writeFirmEntitlements(firmId);
  await recordAudit({
    action: mode === "grant" ? "ops.entitlement.granted" : "ops.entitlement.revoked",
    resourceType: "firm",
    resourceId: firmId,
    firmId,
    actorId: setBy,
    metadata: { entitlement, reason, entitlements },
  });
  return entitlements;
}

/**
 * Append a per-user override and audit it.
 *
 * No Clerk write, deliberately: per-user overrides are never mirrored onto the
 * user or the membership, so a revoke bites on the very next request instead of
 * waiting for a session token to refresh. That also means there is nothing here
 * for the reconcile cron to fall out of sync with.
 *
 * Not transactional, matching `setEntitlementOverride`: the row is the durable
 * source of truth, and the audit writer already swallows its own failures.
 */
export async function setUserEntitlementOverride(args: {
  firmId: string;
  clerkUserId: string;
  entitlement: string;
  mode: "grant" | "revoke";
  reason: string;
  setBy: string; // ops clerk_user_id (from requireOpsAdmin)
}): Promise<void> {
  const { firmId, clerkUserId, entitlement, mode, reason, setBy } = args;
  await db
    .insert(opsUserEntitlementOverrides)
    .values({ firmId, clerkUserId, entitlement, mode, reason, setBy });
  await recordAudit({
    action:
      mode === "grant" ? "ops.user_entitlement.granted" : "ops.user_entitlement.revoked",
    resourceType: "firm_member",
    resourceId: clerkUserId,
    firmId,
    actorId: setBy,
    metadata: { entitlement, reason },
  });
}
