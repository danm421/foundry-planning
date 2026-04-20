import {
  runWithActingContext,
  getCurrentActingContext,
  type ActingContext,
} from "@foundry/auth";

export function adminQuery<T>(
  ctx: ActingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithActingContext(ctx, fn);
}

export function getScopedContext(): ActingContext | undefined {
  return getCurrentActingContext();
}

export type AuditLogEntry = {
  action: string;
  resourceType: string;
  resourceId: string;
  clientId?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogRow = {
  firmId: string;
  actorId: string;
  actingAsAdvisorId: string;
  impersonationSessionId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  clientId: string | null;
  metadata: Record<string, unknown> | null;
};

export type AuditInserter = (row: AuditLogRow) => Promise<void>;

export async function writeAuditLog(
  entry: AuditLogEntry,
  inserter: AuditInserter,
): Promise<void> {
  const ctx = getCurrentActingContext();
  if (!ctx) {
    throw new Error("No acting context — call writeAuditLog inside adminQuery");
  }
  if (!ctx.impersonation) {
    throw new Error(
      "No impersonation session — admins must impersonate before mutating tenant data",
    );
  }

  await inserter({
    firmId: ctx.impersonation.firmId,
    actorId: ctx.actorAdminId,
    actingAsAdvisorId: ctx.impersonation.advisorClerkUserId,
    impersonationSessionId: ctx.impersonation.sessionId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    clientId: entry.clientId ?? null,
    metadata: entry.metadata ?? null,
  });
}

export const defaultAuditInserter: AuditInserter = async (row) => {
  const [{ db }, { auditLog }] = await Promise.all([
    import("./index"),
    import("./schema"),
  ]);
  await db.insert(auditLog).values({
    firmId: row.firmId,
    actorId: row.actorId,
    actingAsAdvisorId: row.actingAsAdvisorId,
    impersonationSessionId: row.impersonationSessionId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    clientId: row.clientId,
    metadata: row.metadata,
  });
};
