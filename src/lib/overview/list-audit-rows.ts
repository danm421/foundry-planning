import { db } from "@/db";
import { auditLog, clients } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export async function listAuditRows(
  clientId: string,
  firmId: string,
  opts: { limit?: number } = {},
) {
  const { limit = 10 } = opts;
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .innerJoin(clients, eq(clients.id, auditLog.clientId))
    .where(and(eq(auditLog.clientId, clientId), eq(clients.firmId, firmId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

export type AuditRowSummary = Awaited<ReturnType<typeof listAuditRows>>[number];
