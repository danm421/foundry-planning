import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { opsUserEntitlementOverrides } from "@/db/schema";
import { collapseActiveOverrides, type ActiveOverride, type OverrideRow } from "./overrides";

/** The six columns `collapseActiveOverrides` consumes. */
const COLUMNS = {
  entitlement: opsUserEntitlementOverrides.entitlement,
  mode: opsUserEntitlementOverrides.mode,
  reason: opsUserEntitlementOverrides.reason,
  setBy: opsUserEntitlementOverrides.setBy,
  expiresAt: opsUserEntitlementOverrides.expiresAt,
  createdAt: opsUserEntitlementOverrides.createdAt,
};

/**
 * The active per-user overrides for ONE user in ONE firm.
 *
 * React.cache'd because the portal gates can run several times in a single
 * request — a page, its nested layout, and a route handler all ask.
 *
 * Blank inputs short-circuit rather than querying: a missing firm or user id is
 * never a legitimate lookup, and returning [] makes the caller fall back to the
 * firm's own setting rather than inventing an override.
 */
export const getActiveUserOverrides = cache(
  async (firmId: string, clerkUserId: string): Promise<ActiveOverride[]> => {
    if (!firmId || !clerkUserId) return [];
    const rows = await db
      .select(COLUMNS)
      .from(opsUserEntitlementOverrides)
      .where(
        and(
          eq(opsUserEntitlementOverrides.firmId, firmId),
          eq(opsUserEntitlementOverrides.clerkUserId, clerkUserId),
        ),
      )
      .orderBy(opsUserEntitlementOverrides.createdAt);
    return collapseActiveOverrides(rows, new Date());
  },
);

/**
 * Every member's active overrides for one firm, grouped by user. One query for
 * the whole ops Members table — never one per member.
 */
export const getActiveUserOverridesForFirm = cache(
  async (firmId: string): Promise<Map<string, ActiveOverride[]>> => {
    if (!firmId) return new Map();
    const rows = await db
      .select({ ...COLUMNS, clerkUserId: opsUserEntitlementOverrides.clerkUserId })
      .from(opsUserEntitlementOverrides)
      .where(eq(opsUserEntitlementOverrides.firmId, firmId))
      .orderBy(opsUserEntitlementOverrides.createdAt);

    const byUser = new Map<string, OverrideRow[]>();
    for (const r of rows) {
      const list = byUser.get(r.clerkUserId) ?? [];
      list.push(r);
      byUser.set(r.clerkUserId, list);
    }
    const now = new Date();
    return new Map(
      Array.from(byUser, ([userId, list]) => [userId, collapseActiveOverrides(list, now)]),
    );
  },
);
