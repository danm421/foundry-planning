import { isAuditValueEqual } from "./equality";
import { humanizeFieldName } from "./labels";
import type {
  AuditValue,
  EntitySnapshot,
  FieldChange,
  FieldLabels,
} from "./types";

/**
 * Diff two entity snapshots into renderable field changes.
 *
 * Extracted from `recordUpdate` so the CRM activity feed and the firm-wide
 * audit log build changes identically. Adds two behaviours the audit path
 * never needed but the CRM one does:
 *  - `sensitive` descriptors emit the change with null values + `redacted`,
 *    so SSN/DOB/account numbers are never persisted into a feed row.
 *  - `truncate` descriptors clip long free text (appending an ellipsis, which
 *    is the only truncation signal renderers need) so a jsonb column doesn't
 *    accumulate whole note bodies.
 */
export function buildFieldChanges(
  before: EntitySnapshot,
  after: EntitySnapshot,
  fieldLabels: FieldLabels,
): FieldChange[] {
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

    if (descriptor.sensitive) {
      changes.push({
        field: key,
        label: descriptor.label,
        from: null,
        to: null,
        format: descriptor.format,
        redacted: true,
      });
      continue;
    }

    const limit = descriptor.truncate;
    const clip = (v: AuditValue): AuditValue =>
      limit != null && typeof v === "string" && v.length > limit
        ? `${v.slice(0, limit)}…`
        : v;

    changes.push({
      field: key,
      label: descriptor.label,
      from: clip(fromValue),
      to: clip(toValue),
      format: descriptor.format,
    });
  }

  return changes;
}
