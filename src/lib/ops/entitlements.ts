import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { opsEntitlementOverrides, subscriptions, subscriptionItems } from "@/db/schema";
import {
  deriveEntitlements,
  type EntitlementOverride,
  type StripeItemView,
} from "@/lib/billing/entitlements";
import { recordAudit } from "@/lib/audit";

/** Capability keys the Entitlements tab can toggle (label/description drive the
 *  UI). Both ship seat-included today; an override here grants/revokes per-firm. */
export type CapabilityKey = { key: string; label: string; description: string };
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
];

/** A raw override row as loaded from the table (mode is DB `text`). */
export type OverrideRow = {
  entitlement: string;
  mode: string;
  reason: string;
  setBy: string;
  expiresAt: Date | null;
  createdAt: Date;
};

/** The latest active override for an entitlement, with attribution for the UI. */
export type ActiveOverride = {
  entitlement: string;
  mode: "grant" | "revoke";
  reason: string;
  setBy: string;
  expiresAt: Date | null;
  createdAt: Date;
};

const LIVE_SUB_STATUSES = ["trialing", "active", "past_due", "unpaid", "paused"];

/**
 * Pure: keep only active rows (no expiry or future expiry), then the latest row
 * per entitlement by createdAt. `now` is a parameter so this is unit-testable.
 * Result is sorted by entitlement key for stable rendering.
 */
export function collapseActiveOverrides(rows: OverrideRow[], now: Date): ActiveOverride[] {
  const latest = new Map<string, OverrideRow>();
  for (const r of rows) {
    if (r.expiresAt !== null && r.expiresAt <= now) continue; // expired
    if (r.mode !== "grant" && r.mode !== "revoke") continue; // defensive
    const prev = latest.get(r.entitlement);
    if (!prev || r.createdAt > prev.createdAt) latest.set(r.entitlement, r);
  }
  return Array.from(latest.values())
    .map((r) => ({
      entitlement: r.entitlement,
      mode: r.mode as "grant" | "revoke",
      reason: r.reason,
      setBy: r.setBy,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => a.entitlement.localeCompare(b.entitlement));
}

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
