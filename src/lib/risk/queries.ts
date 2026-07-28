//
// Read-only queries backing the Risk household list. This is a denormalized
// snapshot read off `client_risk_profiles` -- never a live recompute -- so the
// list page can render without running a projection per household.
import { db } from "@/db";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { clients, crmHouseholds, clientRiskProfiles } from "@/db/schema";
import {
  resolveVisibleAdvisorIds,
  advisorScopeCondition,
  applyBookSwitcher,
} from "@/lib/visibility";
import type { RiskLevel } from "@/lib/risk-levels";
import type { BindingConstraint } from "./scoring";

export const REVIEW_DUE_MONTHS = 12;

export interface RiskListRow {
  clientId: string;
  householdName: string;
  compositeScore: number | null;
  compositeLevel: RiskLevel | null;
  bindingConstraint: BindingConstraint;
  toleranceScore: number | null;
  toleranceSource: "rtq_client" | "rtq_advisor" | "manual" | null;
  toleranceConfirmedAt: Date | null;
  capacityScore: number | null;
  environmentAdj: number;
  requiredGrowthPct: number | null;
  updatedAt: Date | null;
}

export interface RiskListFlags {
  notEstablished: boolean;
  reviewDue: boolean;
  capacityConstrained: boolean;
  goalsOverReaching: boolean;
  capacityPending: boolean;
}

export function deriveListFlags(row: RiskListRow, now: Date): RiskListFlags {
  const notEstablished = row.toleranceScore === null;

  const dueAfter = row.toleranceConfirmedAt
    ? new Date(row.toleranceConfirmedAt)
    : null;
  if (dueAfter) dueAfter.setMonth(dueAfter.getMonth() + REVIEW_DUE_MONTHS);

  return {
    notEstablished,
    // A household with no profile is "not established", not "review due" --
    // two different calls to action.
    reviewDue: !notEstablished && dueAfter !== null && dueAfter <= now,
    capacityConstrained: row.bindingConstraint === "capacity",
    goalsOverReaching:
      row.requiredGrowthPct !== null &&
      row.capacityScore !== null &&
      row.requiredGrowthPct > row.capacityScore,
    capacityPending: row.capacityScore === null,
  };
}

/**
 * Every household the caller can see, with its profile. LEFT JOIN so households
 * that have never been profiled still appear -- surfacing those is the main
 * reason this page exists.
 *
 * Scoping mirrors listCrmHouseholds exactly. Without it the Risk page becomes a
 * way to enumerate households outside the caller's book.
 */
export async function listRiskProfiles(opts?: {
  viewAsAdvisorId?: string;
}): Promise<RiskListRow[]> {
  const firmId = await requireOrgId();
  const { userId, orgRole } = await auth();

  let visible = await resolveVisibleAdvisorIds(userId ?? "", orgRole, firmId);
  visible = applyBookSwitcher(visible, orgRole, opts?.viewAsAdvisorId);
  const scope = advisorScopeCondition(crmHouseholds.advisorId, visible);

  const conditions = [
    eq(crmHouseholds.firmId, firmId),
    isNull(crmHouseholds.deletedAt),
  ];
  if (scope) conditions.push(scope);

  const rows = await db
    .select({
      clientId: clients.id,
      householdName: crmHouseholds.name,
      compositeScore: clientRiskProfiles.compositeScore,
      compositeLevel: clientRiskProfiles.compositeLevel,
      bindingConstraint: clientRiskProfiles.bindingConstraint,
      toleranceScore: clientRiskProfiles.toleranceScore,
      toleranceSource: clientRiskProfiles.toleranceSource,
      toleranceConfirmedAt: clientRiskProfiles.toleranceConfirmedAt,
      capacityScore: clientRiskProfiles.capacityScore,
      environmentAdj: clientRiskProfiles.environmentAdj,
      requiredGrowthPct: clientRiskProfiles.requiredGrowthPct,
      updatedAt: clientRiskProfiles.updatedAt,
    })
    .from(clients)
    .innerJoin(crmHouseholds, eq(crmHouseholds.id, clients.crmHouseholdId))
    .leftJoin(clientRiskProfiles, eq(clientRiskProfiles.clientId, clients.id))
    .where(and(...conditions));

  return rows.map((r) => ({
    ...r,
    bindingConstraint: r.bindingConstraint ?? "none",
    environmentAdj: r.environmentAdj ?? 0,
  }));
}
