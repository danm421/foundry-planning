// src/lib/fact-finder/placement/map/helpers.ts
/**
 * What every section map uses: cells read as their type, DraftBuilder (one
 * record write), the row's record from its confirmed link, and Owner columns
 * or "Name 60%, Name 40%" text turned into people. Pure.
 */
import { isRecordRef, lineIdOf, type CellRef, type PlacedValue, type RecordRef, type TargetKind } from "../../change-set";
import { findColumn } from "../../schema";
import type { FFRow } from "../../types";
import { findPerson, findTrust, hasCoClient, householdPerson, NO_CO_CLIENT_REASON, type PersonKind } from "../refs";
import { targetField } from "../targets";
import { parseShares, toFraction, yesNo } from "../translate";
import type { DraftField, TargetDraft } from "../types";
import type { PlaceContext } from "./types";

/** A text or choice cell (a choice holds its option label), trimmed; null when blank. */
export function text(row: FFRow, columnId: string): string | null {
  const v = row.cells[columnId]?.value;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** A money, number, percent, integer or year cell. */
export function num(row: FFRow, columnId: string): number | null {
  const v = row.cells[columnId]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A check cell, or a Yes / No choice. */
export function bool(row: FFRow, columnId: string): boolean | null {
  const v = row.cells[columnId]?.value;
  if (typeof v === "boolean") return v;
  return typeof v === "string" ? yesNo(v.trim()) : null;
}

/** A percent cell as a fraction: 6.5 → 0.065. */
export function rate(row: FFRow, columnId: string): number | null {
  const v = num(row, columnId);
  return v === null ? null : toFraction(v);
}

export function cellOf(sectionId: string, row: FFRow, columnId: string): CellRef {
  return { sectionId, rowId: row.id, columnId };
}

const isBlank = (v: PlacedValue) => v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Every `line` ref inside a value. */
function addLineRefs(value: PlacedValue, into: Set<string>): void {
  if (isRecordRef(value)) {
    if (value.ref === "line") into.add(value.lineId);
  } else if (Array.isArray(value)) {
    for (const v of value) addLineRefs(v, into);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) addLineRefs(v, into);
  }
}

/**
 * One record write for a row. `put` skips a blank value (a blank cell never
 * erases) and records the cells a value came from — a column of this row, or
 * any cell. A `line` ref in a value, `with`, `fixed` or `parent` makes the
 * draft depend on that line by itself.
 */
export class DraftBuilder {
  readonly lineId: string;
  private readonly fields: DraftField[] = [];
  private readonly warnings: string[] = [];
  private readonly depends = new Set<string>();
  private blocked?: { reason: string; cell?: CellRef };

  constructor(
    private readonly init: {
      sectionId: string;
      row: FFRow;
      target: TargetKind;
      recordId: string | null;
      label: string;
      /** A second line of one target from one row (1, 2…). */
      n?: number;
      fixed?: Record<string, PlacedValue>;
      /** The record this one hangs off. */
      parent?: RecordRef;
    },
  ) {
    this.lineId = lineIdOf(init.row.id, init.target, init.n);
    if (init.fixed) addLineRefs(init.fixed, this.depends);
    if (init.parent) addLineRefs(init.parent, this.depends);
  }

  /** The record this draft writes: the one on record, or the one its line creates. */
  get ref(): RecordRef {
    const { target, recordId } = this.init;
    return recordId ? { ref: "record", target, id: recordId } : { ref: "line", target, lineId: this.lineId };
  }

  put(key: string, value: PlacedValue | undefined, columns: readonly (string | CellRef)[], withValues?: Record<string, PlacedValue>): this {
    if (!targetField(this.init.target, key)) throw new Error(`${this.init.target} has no field "${key}" (placement/targets.ts)`);
    if (this.fields.some((f) => f.key === key)) throw new Error(`${this.lineId}: "${key}" placed twice`);
    if (value === undefined || isBlank(value)) return this;
    const from = columns.map((c) => (typeof c === "string" ? cellOf(this.init.sectionId, this.init.row, c) : c));
    this.fields.push({ key, value, from, ...(withValues ? { with: withValues } : {}) });
    addLineRefs(value, this.depends);
    if (withValues) addLineRefs(withValues, this.depends);
    return this;
  }

  warn(message: string): this {
    if (!this.warnings.includes(message)) this.warnings.push(message);
    return this;
  }

  /** The line can't save: why, and the cell to fix (a column of this row, or any cell). The first block wins. */
  block(reason: string, cell?: string | CellRef): this {
    if (this.blocked) return this;
    const at = typeof cell === "string" ? cellOf(this.init.sectionId, this.init.row, cell) : cell;
    this.blocked = { reason, ...(at ? { cell: at } : {}) };
    return this;
  }

  /** Depend on the line a ref names (a record or person ref needs nothing). */
  dependOn(ref: RecordRef | null | undefined): this {
    if (ref?.ref === "line") this.depends.add(ref.lineId);
    return this;
  }

  build(): TargetDraft {
    const { sectionId, row, target, recordId, label, fixed, parent } = this.init;
    return {
      lineId: this.lineId,
      sectionId,
      rowId: row.id,
      target,
      recordId,
      label,
      ...(fixed ? { fixed } : {}),
      fields: [...this.fields],
      warnings: [...this.warnings],
      ...(this.blocked ? { blocked: this.blocked } : {}),
      ...(parent ? { parent } : {}),
      ...(this.depends.size > 0 ? { dependsOn: [...this.depends] } : {}),
    };
  }
}

/** The row's confirmed link, resolved against the book (Plan 2 M4): a record id, or null for New / no link / a record not in the book. */
export function linkedRecordId(row: FFRow, ctx: PlaceContext, targets: readonly TargetKind[]): string | null {
  const link = row.link;
  if (link?.kind !== "existing" || !link.confirmed) return null;
  return targets.some((t) => ctx.book.records[t].some((r) => r.id === link.recordId)) ? link.recordId : null;
}

/** Owner + "Which trust / entity" → owner shares (fractions). A blank Owner is no owners (no field). */
export function ownersOf(
  sectionId: string,
  row: FFRow,
  ctx: PlaceContext,
  opts: { ownerColumn?: string } = {},
): { ok: true; owners: { who: RecordRef; percent: number }[] } | { ok: false; reason: string; columnId: string } {
  const columnId = opts.ownerColumn ?? "owner";
  const owner = text(row, columnId);
  const client = householdPerson(ctx.refs, "client");
  const spouse = householdPerson(ctx.refs, "spouse");
  switch (owner) {
    case null:
      return { ok: true, owners: [] };
    case "Client":
      return { ok: true, owners: [{ who: client, percent: 1 }] };
    case "Co-client":
    case "Joint":
      if (!hasCoClient(ctx.refs)) return { ok: false, reason: NO_CO_CLIENT_REASON, columnId };
      return {
        ok: true,
        owners: owner === "Joint" ? [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }] : [{ who: spouse, percent: 1 }],
      };
    case "Trust / entity": {
      const name = text(row, "ownerEntity");
      if (name === null) return { ok: false, reason: "Pick which trust or entity owns it.", columnId: "ownerEntity" };
      const trust = findTrust(ctx.refs, name);
      return trust.ok ? { ok: true, owners: [{ who: trust.ref, percent: 1 }] } : { ok: false, reason: trust.reason, columnId: "ownerEntity" };
    }
    default:
      return {
        ok: false,
        reason: `${findColumn(sectionId, columnId)?.label ?? "Owner"}: "${owner}" isn't one of the options — pick one.`,
        columnId,
      };
  }
}

/** "Emma 60%, Lucas 40%" (or "… equally") → each name resolved by findPerson, with its whole percent. Not ok: the first reason. */
export function sharesOf(
  value: string,
  ctx: PlaceContext,
  allow: readonly PersonKind[],
): { ok: true; shares: { who: RecordRef; percent: number; label: string }[] } | { ok: false; reason: string } {
  const parsed = parseShares(value);
  if (!parsed.ok) return parsed;
  const shares: { who: RecordRef; percent: number; label: string }[] = [];
  for (const part of parsed.parts) {
    const found = findPerson(ctx.refs, part.name, { allow });
    if (!found.ok) return found;
    shares.push({ who: found.ref, percent: part.percent, label: found.label });
  }
  return { ok: true, shares };
}
