import { recordAudit, type AuditAction } from "@/lib/audit";
import { isAuditValueEqual } from "./equality";
import { humanizeFieldName } from "./labels";
import type {
  AuditValue,
  EntitySnapshot,
  FieldChange,
  FieldLabels,
} from "./types";

type Common = {
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  clientId: string | null;
  firmId: string;
  actorId?: string;
};

export async function recordCreate(
  args: Common & { snapshot: EntitySnapshot },
): Promise<void> {
  const { snapshot, ...rest } = args;
  await recordAudit({ ...rest, metadata: { kind: "create", snapshot } });
}

export async function recordDelete(
  args: Common & { snapshot: EntitySnapshot },
): Promise<void> {
  const { snapshot, ...rest } = args;
  await recordAudit({ ...rest, metadata: { kind: "delete", snapshot } });
}

export async function recordUpdate(
  args: Common & {
    before: EntitySnapshot;
    after: EntitySnapshot;
    fieldLabels: FieldLabels;
  },
): Promise<void> {
  const { before, after, fieldLabels, ...rest } = args;

  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  );

  const changes: FieldChange[] = [];
  for (const key of keys) {
    const fromValue: AuditValue = key in before ? before[key]! : null;
    const toValue: AuditValue = key in after ? after[key]! : null;
    if (isAuditValueEqual(fromValue, toValue)) continue;

    const descriptor = fieldLabels[key] ?? {
      label: humanizeFieldName(key),
      format: "text" as const,
    };

    changes.push({
      field: key,
      label: descriptor.label,
      from: fromValue,
      to: toValue,
      format: descriptor.format,
    });
  }

  if (changes.length === 0) return;

  await recordAudit({ ...rest, metadata: { kind: "update", changes } });
}
