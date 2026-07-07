// Client-controlled advisor-sharing switches for the portal's budgeting areas
// (transactions, budgets & categories, recurrings). The client manages these on
// /portal/settings; every advisor-mode read path must come through here.
// Accounts/balances/investments/profile are never gated — they are the planning
// data the advisor manages.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { portalPrivacySettings } from "@/db/schema";
import { ForbiddenError } from "@/lib/authz";
import type { PortalActorMode } from "@/lib/portal/resolve-portal-client";

export type PortalArea = "transactions" | "budgets" | "recurrings";

export interface PortalPrivacy {
  shareTransactions: boolean;
  shareBudgets: boolean;
  shareRecurrings: boolean;
}

/** Missing row = share everything (the pre-feature behavior). */
export const DEFAULT_PORTAL_PRIVACY: PortalPrivacy = {
  shareTransactions: true,
  shareBudgets: true,
  shareRecurrings: true,
};

export async function loadPortalPrivacy(clientId: string): Promise<PortalPrivacy> {
  const [row] = await db
    .select({
      shareTransactions: portalPrivacySettings.shareTransactions,
      shareBudgets: portalPrivacySettings.shareBudgets,
      shareRecurrings: portalPrivacySettings.shareRecurrings,
    })
    .from(portalPrivacySettings)
    .where(eq(portalPrivacySettings.clientId, clientId))
    .limit(1);
  return row ?? DEFAULT_PORTAL_PRIVACY;
}

export function areaShared(privacy: PortalPrivacy, area: PortalArea): boolean {
  switch (area) {
    case "transactions":
      return privacy.shareTransactions;
    case "budgets":
      return privacy.shareBudgets;
    case "recurrings":
      return privacy.shareRecurrings;
  }
}

/**
 * Route-handler gate for `/api/portal/*`. A real client always passes (they
 * are looking at their own data); an advisor in act-as-client preview is
 * rejected when the client has switched the area off.
 */
export async function requireAreaShared(
  mode: PortalActorMode,
  clientId: string,
  area: PortalArea,
): Promise<void> {
  if (mode !== "advisor") return;
  const privacy = await loadPortalPrivacy(clientId);
  if (!areaShared(privacy, area)) {
    throw new ForbiddenError("The client has not shared this with their advisor");
  }
}

/**
 * Audit resourceTypes whose diffs belong to a gated budgeting area — used to
 * filter the advisor-facing portal activity feed. resourceTypes not listed
 * (accounts, plaid items, family, …) are always visible.
 */
export const AREA_BY_RESOURCE_TYPE: Readonly<Record<string, PortalArea>> = {
  plaid_transaction: "transactions",
  budget: "budgets",
  transaction_category: "budgets",
  transaction_rule: "budgets",
  recurring_transaction: "recurrings",
};
