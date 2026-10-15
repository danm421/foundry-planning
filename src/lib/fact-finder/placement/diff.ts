// src/lib/fact-finder/placement/diff.ts
/**
 * Drafts against the record book (D8). A draft with no record is a Create with
 * every value it placed; one with a record is an Update with only the values
 * that differ, or "No changes" when none do. An empty value never becomes a
 * field, so a blank fact finder cell never erases a value on record. A name or
 * owner that would overwrite one on record starts unticked. Pure.
 */
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { isRecordRef, type ChangeField, type ChangeLine, type PlacedValue, type RecordRef } from "../change-set";
import { findSection } from "../schema";
import { TARGETS, targetField, type TargetField } from "./targets";
import type { DraftField, RecordBook, TargetDraft } from "./types";
import { formatValue, isEmptyValue, sameValue } from "./values";

const GONE = "That record is no longer on the plan — review again.";
/** Household fields that set the year each scenario's plan ends. */
const PLAN_END_FIELDS = new Set(["dateOfBirth", "spouseDob", "lifeExpectancy", "spouseLifeExpectancy"]);

export function diffDrafts(drafts: readonly TargetDraft[], book: RecordBook): ChangeLine[] {
  const labelOf = refLabels(drafts, book);
  return drafts.map((draft) => diffDraft(draft, book, labelOf));
}

function diffDraft(draft: TargetDraft, book: RecordBook, labelOf: (ref: RecordRef) => string): ChangeLine {
  const section = findSection(draft.sectionId);
  if (!section) throw new Error(`Draft ${draft.lineId}: no fact finder section "${draft.sectionId}"`);
  const record = draft.recordId === null ? undefined : book.records[draft.target].find((r) => r.id === draft.recordId);
  const vanished = draft.recordId !== null && record === undefined;

  const fields: ChangeField[] = [];
  for (const placed of draft.fields) {
    if (isEmptyValue(placed.value)) continue;
    const spec = targetField(draft.target, placed.key);
    if (!spec) throw new Error(`Draft ${draft.lineId}: ${draft.target}.${placed.key} isn't in the targets catalog`);
    const show = (value: PlacedValue) =>
      formatValue(spec.kind, asPeople(value, book.people), { options: spec.options, labelOf });
    if (!record) {
      fields.push(changeField(placed, spec, undefined, show));
      continue;
    }
    const onRecord = record.values[placed.key];
    if (sameValue(spec.kind, placed.value, onRecord, book.people)) continue;
    fields.push(changeField(placed, spec, isEmptyValue(onRecord) ? null : onRecord, show));
  }

  // A warning about one field speaks only when that field changes.
  const keys = new Set(fields.map((f) => f.key));
  const warnings = draft.warnings.flatMap((w) => (typeof w === "string" ? [w] : keys.has(w.field) ? [w.text] : []));
  const planEnd = draft.target === "client_household" ? fields.filter((f) => PLAN_END_FIELDS.has(f.key)) : [];
  if (planEnd.length > 0) {
    const names = planEnd.map((f) => f.label.toLowerCase());
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    warnings.push(`Changing the ${list} moves every scenario's plan end.`);
  }
  const blocked = draft.blocked ?? (vanished ? { reason: GONE } : undefined);

  return {
    id: draft.lineId,
    page: section.page,
    sectionId: draft.sectionId,
    rowId: draft.rowId,
    target: draft.target,
    action: draft.recordId === null ? "create" : vanished || fields.length > 0 ? "update" : "none",
    recordId: draft.recordId,
    label: draft.label,
    ...(draft.fixed ? { fixed: draft.fixed } : {}),
    fields,
    warnings,
    ...(blocked ? { blocked } : {}),
    ...(draft.parent ? { parent: draft.parent } : {}),
    ...(draft.dependsOn ? { dependsOn: draft.dependsOn } : {}),
    ...(draft.aiPlaced ? { aiPlaced: true as const } : {}),
  };
}

/** `onRecord`: undefined on a Create (and when the record is gone), null when the record's value is empty. */
function changeField(
  placed: DraftField,
  spec: TargetField,
  onRecord: PlacedValue | undefined,
  show: (value: PlacedValue) => string,
): ChangeField {
  return {
    key: placed.key,
    label: spec.label,
    next: placed.value,
    ...(onRecord !== undefined ? { onRecord } : {}),
    shown: onRecord === undefined ? { next: show(placed.value) } : { next: show(placed.value), onRecord: show(onRecord) },
    ticked: !(spec.identity && onRecord !== undefined && onRecord !== null),
    from: placed.from,
    ...(placed.with ? { with: placed.with } : {}),
    ...(placed.ai ? { ai: placed.ai } : {}),
  };
}

/** The book names the client and co-client by their family member records; print them as the people they are. */
function asPeople(value: PlacedValue, people: RecordBook["people"]): PlacedValue {
  if (isRecordRef(value)) {
    if (value.ref !== "record") return value;
    if (value.id === people.client) return { ref: "person", role: "client" };
    if (value.id === people.spouse) return { ref: "person", role: "spouse" };
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => asPeople(v, people));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asPeople(v, people)]));
  }
  return value;
}

/** A line ref prints its row's draft label, a record ref the record's label, a person their first name. */
function refLabels(drafts: readonly TargetDraft[], book: RecordBook): (ref: RecordRef) => string {
  const lines = new Map(drafts.map((d) => [d.lineId, d.label]));
  return (ref) => {
    if (ref.ref === "person") return book.names[ref.role] ?? (ref.role === "client" ? "Client" : CO_CLIENT_LABEL);
    if (ref.ref === "line") return lines.get(ref.lineId) ?? TARGETS[ref.target].label;
    return book.records[ref.target].find((r) => r.id === ref.id)?.label ?? TARGETS[ref.target].label;
  };
}
