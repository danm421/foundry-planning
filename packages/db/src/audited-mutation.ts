import { getAdvisorContext } from '@foundry/auth';
import { defaultAuditInserter } from './admin-scope';

export type AuditedMutationEntry = {
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
};

export type AuditedMutationRow = {
  actorAdminId: string;
  impersonationSessionId: string;
  actingAsAdvisorId: string;
  firmId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown> | null;
};

type AuditInserter = (row: AuditedMutationRow) => Promise<void>;

// Production default: bridge to the existing defaultAuditInserter via the AuditLogRow shape.
const productionInserter: AuditInserter = async (row) => {
  await defaultAuditInserter({
    firmId: row.firmId,
    actorId: row.actorAdminId,
    actingAsAdvisorId: row.actingAsAdvisorId,
    impersonationSessionId: row.impersonationSessionId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    clientId: null,
    metadata: row.metadata,
  });
};

let inserter: AuditInserter = productionInserter;

export function __setAuditInserterForTest(fn: AuditInserter): void {
  inserter = fn;
}

export function __resetAuditInserterForTest(): void {
  inserter = productionInserter;
}

export async function auditedMutation<T>(
  entry: AuditedMutationEntry,
  run: () => Promise<T>,
): Promise<T> {
  const ctx = await getAdvisorContext();
  // Run the mutation first — only audit on success.
  const result = await run();
  if (ctx.kind === 'impersonated') {
    await inserter({
      actorAdminId: ctx.actorAdminId,
      impersonationSessionId: ctx.sessionId,
      actingAsAdvisorId: ctx.clerkUserId,
      firmId: ctx.firmId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata ?? null,
    });
  }
  return result;
}
