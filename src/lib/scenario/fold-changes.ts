// Pure fold of extra (held) changes over saved scenario changes. Mirrors the
// writer's applyEntityAdd / applyEntityEdit / applyEntityRemove branches per
// (targetKind, targetId), minus the writer's re-diff against base. Client-safe:
// no db, no node: imports.
import type { ScenarioChange } from "@/engine/scenario/types";
import { priorToValues } from "./field-diff";

const sameTarget = (a: ScenarioChange, b: ScenarioChange) =>
  a.targetKind === b.targetKind && a.targetId === b.targetId;

function append(rows: ScenarioChange[], change: ScenarioChange): ScenarioChange[] {
  const orderIndex = rows.reduce((m, r) => Math.max(m, r.orderIndex), -1) + 1;
  return [...rows, { ...change, orderIndex }];
}

function isRiderOf(row: ScenarioChange, accountId: string): boolean {
  const p = row.payload as { isDefaultChecking?: unknown; parentAccountId?: unknown } | null;
  return (
    row.opType === "add" &&
    row.targetKind === "account" &&
    p?.isDefaultChecking === true &&
    p.parentAccountId === accountId
  );
}

function foldOne(rows: ScenarioChange[], extra: ScenarioChange): ScenarioChange[] {
  const mine = rows.filter((r) => sameTarget(r, extra));
  const existingAdd = mine.find((r) => r.opType === "add");
  const existingEdit = mine.find((r) => r.opType === "edit");

  if (extra.opType === "add") {
    if (existingAdd) {
      return rows.map((r) =>
        r === existingAdd
          ? { ...r, payload: extra.payload, toggleGroupId: extra.toggleGroupId ?? r.toggleGroupId }
          : r,
      );
    }
    return append(rows, extra);
  }

  if (extra.opType === "edit") {
    if (existingAdd) {
      const merged = {
        ...(existingAdd.payload as Record<string, unknown>),
        ...priorToValues(extra.payload),
      };
      // A legacy edit row alongside the add is dropped, as the writer does.
      return rows
        .filter((r) => !(sameTarget(r, extra) && r.opType === "edit"))
        .map((r) => (r === existingAdd ? { ...r, payload: merged } : r));
    }
    if (existingEdit) {
      const merged = {
        ...(existingEdit.payload as Record<string, unknown>),
        ...(extra.payload as Record<string, unknown>),
      };
      return rows.map((r) =>
        r === existingEdit
          ? { ...r, payload: merged, toggleGroupId: extra.toggleGroupId ?? r.toggleGroupId }
          : r,
      );
    }
    return append(rows, extra);
  }

  // remove
  if (existingAdd && extra.targetKind !== "gift") {
    const rest = rows.filter((r) => !sameTarget(r, extra));
    if (extra.targetKind !== "account") return rest;
    // A scenario-added account takes its business cash rider with it and
    // releases any other child to the top level (dropAddedAccountChildren).
    return rest
      .filter((r) => !isRiderOf(r, extra.targetId))
      .map((r) => {
        const p = r.payload as { parentAccountId?: unknown } | null;
        return r.opType === "add" && p?.parentAccountId === extra.targetId
          ? { ...r, payload: { ...p, parentAccountId: null } }
          : r;
      });
  }
  // Base entity, or any gift: supersede edits (and a gift's add) with a marker.
  const kept = rows.filter(
    (r) =>
      !(
        sameTarget(r, extra) &&
        (r.opType === "edit" || (extra.targetKind === "gift" && r.opType === "add"))
      ),
  );
  const marker = kept.find((r) => sameTarget(r, extra) && r.opType === "remove");
  if (marker) {
    return kept.map((r) =>
      r === marker ? { ...r, toggleGroupId: extra.toggleGroupId ?? r.toggleGroupId } : r,
    );
  }
  return append(kept, extra);
}

export function foldChanges(saved: ScenarioChange[], extra: ScenarioChange[]): ScenarioChange[] {
  if (extra.length === 0) return saved;
  return extra.reduce(foldOne, saved);
}
