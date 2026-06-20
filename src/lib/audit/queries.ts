import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

export type PortalActivityRow = typeof auditLog.$inferSelect;

/**
 * Read the client-actor slice of the audit log for one household.
 * Reverse-chronological. Used by the advisor's Manage Portal → Recent
 * activity panel. Indexed by `audit_log_firm_created_idx` on the inner
 * scan path — `clientId` is the additional filter and uses the
 * `audit_log_resource_idx` only when the optional `resourceType` is set.
 */
export async function getPortalActivity(args: {
  clientId: string;
  since?: Date;
  resourceType?: string;
  limit?: number;
}): Promise<PortalActivityRow[]> {
  const filters = [
    eq(auditLog.clientId, args.clientId),
    eq(auditLog.actorKind, "client"),
  ];
  if (args.since) filters.push(gte(auditLog.createdAt, args.since));
  if (args.resourceType) filters.push(eq(auditLog.resourceType, args.resourceType));

  return db
    .select()
    .from(auditLog)
    .where(and(...filters))
    .orderBy(desc(auditLog.createdAt))
    .limit(args.limit ?? 50);
}
