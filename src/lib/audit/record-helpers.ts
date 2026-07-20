import { recordAudit, type AuditAction } from "@/lib/audit";
import { buildFieldChanges } from "./build-changes";
import type { EntitySnapshot, FieldLabels } from "./types";

type Common = {
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  clientId: string | null;
  firmId: string;
  actorId?: string;
  // 'advisor' (default) for staff edits, 'client' for portal edits,
  // 'system' for unattended jobs (webhooks, crons).
  actorKind?: "advisor" | "client" | "system";
  extraMetadata?: Record<string, unknown>;
};

export async function recordCreate(
  args: Common & { snapshot: EntitySnapshot },
): Promise<void> {
  const { snapshot, extraMetadata, ...rest } = args;
  await recordAudit({ ...rest, metadata: { kind: "create", snapshot, ...(extraMetadata ?? {}) } });
}

export async function recordDelete(
  args: Common & { snapshot: EntitySnapshot },
): Promise<void> {
  const { snapshot, extraMetadata, ...rest } = args;
  await recordAudit({ ...rest, metadata: { kind: "delete", snapshot, ...(extraMetadata ?? {}) } });
}

export async function recordUpdate(
  args: Common & {
    before: EntitySnapshot;
    after: EntitySnapshot;
    fieldLabels: FieldLabels;
  },
): Promise<void> {
  const { before, after, fieldLabels, extraMetadata, ...rest } = args;

  const changes = buildFieldChanges(before, after, fieldLabels);
  if (changes.length === 0) return;

  await recordAudit({ ...rest, metadata: { kind: "update", changes, ...(extraMetadata ?? {}) } });
}
