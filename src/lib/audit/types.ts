/**
 * Standardized shape of `auditLog.metadata`. Discriminated by `kind` so the
 * activity page renders create / update / delete / other rows differently.
 *
 * Older audit rows (written before this retrofit) have `metadata: null` or an
 * unstructured blob — the activity page treats those as `kind: 'other'` and
 * falls back to a label-only row.
 */

export type DiffFormat = "currency" | "percent" | "date" | "text" | "reference";

/** Reference fields are stored as { id, display } so the audit row stays
 *  readable even if the referenced entity is renamed or deleted later. */
export type ReferenceValue = { id: string; display: string };

/** Any value that can appear in a snapshot or change. Strings, numbers,
 *  booleans, null, ReferenceValue, or arrays of those. No nested objects
 *  beyond ReferenceValue — keeps diffing tractable. */
export type AuditValue =
  | string
  | number
  | boolean
  | null
  | ReferenceValue
  | AuditValue[];

export type EntitySnapshot = Record<string, AuditValue>;

export type FieldChange = {
  field: string;
  label: string;
  from: AuditValue;
  to: AuditValue;
  format: DiffFormat;
};

export type AuditMetadata =
  | { kind: "create"; snapshot: EntitySnapshot }
  | { kind: "update"; changes: FieldChange[] }
  | { kind: "delete"; snapshot: EntitySnapshot }
  | { kind: "other"; note?: string; data?: Record<string, unknown> };

/** Per-entity label/format descriptor: one entry per snapshot field. */
export type FieldLabels = Record<string, { label: string; format: DiffFormat }>;
