// src/lib/fact-finder/placement/map/helpers.ts
/**
 * What every section map uses: cells read as their type, DraftBuilder (one
 * record write), the row's record from its confirmed link, Owner columns or
 * "Name 60%, Name 40%" text turned into people, a beneficiary set tier by
 * tier, and the defaults and rules several sections share. Pure.
 */
import { isRecordRef, lineIdOf, type CellRef, type PlacedValue, type RecordRef, type TargetKind } from "../../change-set";
import { valueFor, type OptionMap } from "../../enums";
import { findColumn } from "../../schema";
import type { FFRow } from "../../types";
import { findPerson, findTrust, hasCoClient, householdPerson, NO_CO_CLIENT_REASON, type PersonKind } from "../refs";
import { targetField } from "../targets";
import { parseShares, toFraction, yesNo } from "../translate";
import { findRecord, type BookRecord, type DraftField, type DraftWarning, type NoteTopic, type RecordBook, type TargetDraft } from "../types";
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

/** A choice cell as its app value. */
export function choice(map: OptionMap, row: FFRow, columnId: string): string | null {
  return valueFor(map, text(row, columnId));
}

export function cellOf(sectionId: string, row: FFRow, columnId: string): CellRef {
  return { sectionId, rowId: row.id, columnId };
}

/** A column's label as the fact finder shows it. */
export function columnLabel(sectionId: string, columnId: string): string {
  return findColumn(sectionId, columnId)?.label ?? columnId;
}

/** `"Benefit years", "Shared care"`: each column's label, quoted. */
export function quotedLabels(sectionId: string, columnIds: readonly string[]): string {
  return columnIds.map((id) => `"${columnLabel(sectionId, id)}"`).join(", ");
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
  private readonly warnings: DraftWarning[] = [];
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

  get sectionId(): string {
    return this.init.sectionId;
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

  /** A warning; with `field`, it's about that field only, and the diff drops it when the field doesn't change. */
  warn(message: string, { field }: { field?: string } = {}): this {
    if (field !== undefined && !targetField(this.init.target, field)) throw new Error(`${this.init.target} has no field "${field}" (placement/targets.ts)`);
    const known = this.warnings.some((w) => (typeof w === "string" ? field === undefined && w === message : w.field === field && w.text === message));
    if (!known) this.warnings.push(field === undefined ? message : { text: message, field });
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

/** The row's confirmed link, resolved against the book (Plan 2 M4): the record, or undefined for New / no link / a record not in the book. */
export function linkedRecord(row: FFRow, ctx: PlaceContext, targets: readonly TargetKind[]): BookRecord | undefined {
  const link = row.link;
  if (link?.kind !== "existing" || !link.confirmed) return undefined;
  for (const target of targets) {
    const record = findRecord(ctx.book, target, link.recordId);
    if (record) return record;
  }
  return undefined;
}

/** linkedRecord's id; null for none. */
export function linkedRecordId(row: FFRow, ctx: PlaceContext, targets: readonly TargetKind[]): string | null {
  return linkedRecord(row, ctx, targets)?.id ?? null;
}

/**
 * Owner + "Which trust / entity" → owner shares (fractions), and the columns
 * they came from. A blank Owner is no owners (no field).
 */
export function ownersOf(
  sectionId: string,
  row: FFRow,
  ctx: PlaceContext,
  opts: { ownerColumn?: string } = {},
): { ok: true; owners: { who: RecordRef; percent: number }[]; columns: string[] } | { ok: false; reason: string; columnId: string } {
  const columnId = opts.ownerColumn ?? "owner";
  const owner = text(row, columnId);
  const client = householdPerson(ctx.refs, "client");
  const spouse = householdPerson(ctx.refs, "spouse");
  const ok = (owners: { who: RecordRef; percent: number }[], columns = [columnId]) => ({ ok: true as const, owners, columns });
  switch (owner) {
    case null:
      return ok([]);
    case "Client":
      return ok([{ who: client, percent: 1 }]);
    case "Co-client":
    case "Joint":
      if (!hasCoClient(ctx.refs)) return { ok: false, reason: NO_CO_CLIENT_REASON, columnId };
      return ok(owner === "Joint" ? [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }] : [{ who: spouse, percent: 1 }]);
    case "Trust / entity": {
      const name = text(row, "ownerEntity");
      if (name === null) return { ok: false, reason: "Pick which trust or entity owns it.", columnId: "ownerEntity" };
      const trust = findTrust(ctx.refs, name);
      return trust.ok ? ok([{ who: trust.ref, percent: 1 }], [columnId, "ownerEntity"]) : { ok: false, reason: trust.reason, columnId: "ownerEntity" };
    }
    default:
      return { ok: false, reason: `${columnLabel(sectionId, columnId)}: "${owner}" isn't one of the options — pick one.`, columnId };
  }
}

/** The business a record on the plan is held through (its `facts.parentAccountId`), by label; null when it isn't. */
export function heldThrough(ctx: PlaceContext, record: BookRecord | undefined): string | null {
  const parentId = record?.facts?.parentAccountId;
  if (typeof parentId !== "string") return null;
  return findRecord(ctx.book, "business_account", parentId)?.label ?? "its business";
}

/** Owner + "Which trust / entity" — except on a record held through a business, which is owned through it (Task 15 ruling). */
export function putOwners(b: DraftBuilder, row: FFRow, ctx: PlaceContext, record: BookRecord | undefined, noun: string): void {
  const held = heldThrough(ctx, record);
  if (held !== null) {
    if (text(row, "owner") !== null) b.warn(`This ${noun} is owned through ${held}.`);
    return;
  }
  const owners = ownersOf(b.sectionId, row, ctx);
  if (!owners.ok) b.block(owners.reason, owners.columnId);
  else b.put("owners", owners.owners, owners.columns);
}

/** A person the plan has no co-client for — the co-client, or both of them — blocks the line at `cell`. True when it did. */
export function needsCoClient(b: DraftBuilder, ctx: PlaceContext, person: string | null, cell?: string | CellRef): boolean {
  const missing = (person === "spouse" || person === "joint") && !hasCoClient(ctx.refs);
  if (missing) b.block(NO_CO_CLIENT_REASON, cell);
  return missing;
}

/**
 * A typed number; else `fallback` — shown on the line, from no cell. A cell
 * that didn't read gets no default: validation asks for it there.
 */
export function putOrDefault(b: DraftBuilder, key: string, row: FFRow, columnId: string, fallback: PlacedValue, ctx: PlaceContext): void {
  const typed = num(row, columnId);
  if (typed !== null) b.put(key, typed, [columnId]);
  else if (!ctx.removed(row.id, columnId)) b.put(key, fallback, []);
}

/** A new income or expense with no typed rate grows with inflation, as the Details dialog defaults (the create schema's own default is a flat 3%). */
export const INFLATION = { growthSource: "inflation" } as const;

/**
 * A rate column → growthRate (a "custom" rate). On a new record (`noun` given)
 * the INFLATION default stands in for a rate cell that didn't read: the line
 * says so (the text itself goes to the AI step).
 */
export function putGrowth(b: DraftBuilder, row: FFRow, columnId: string, ctx: PlaceContext, newRecord: { noun: string } | null): void {
  const growth = rate(row, columnId);
  b.put("growthRate", growth, [columnId], { growthSource: "custom" });
  if (newRecord && growth === null && ctx.removed(row.id, columnId)) {
    b.warn(`"${columnLabel(b.sectionId, columnId)}" didn't read — this ${newRecord.noun} grows with inflation until you set it.`);
  }
}

/** The "as of" for a value with no date of its own: its statement's month, else the month the fact finder was completed. */
export function fallbackAsOf(row: FFRow, ctx: PlaceContext): string | null {
  return (row.statementDate ?? ctx.asOf)?.slice(0, 7) ?? null;
}

/** Balance as of: typed, else (an undated new balance) fallbackAsOf — an unchanged balance isn't re-dated (that would move its amortization). */
export function putBalanceAsOf(b: DraftBuilder, row: FFRow, ctx: PlaceContext, balance: number | null, onRecord: PlacedValue | undefined): void {
  const typed = text(row, "balanceAsOf");
  const held = typeof onRecord === "number" ? onRecord : null;
  if (typed !== null) b.put("balanceAsOf", typed, ["balanceAsOf"]);
  else if (balance !== null && (held === null || Math.abs(held - balance) >= 0.005)) b.put("balanceAsOf", fallbackAsOf(row, ctx), []);
}

/** A plan note's fixed values: an advisor's observation, written by the import (`manual`) or placed by the AI step (`ai`). */
export const noteFixed = (source: "manual" | "ai") => ({ section: "observation", audience: "advisor", source });

/** The plan note with exactly these words (D8); null when the plan has none. */
export function noteOnRecord(book: RecordBook, body: string): string | null {
  return book.records.plan_observation.find((r) => r.values.body === body)?.id ?? null;
}

/** A plan note the import writes itself, from these columns of the row — the same note on record is that record. */
export function planNoteDraft(
  sectionId: string,
  row: FFRow,
  ctx: PlaceContext,
  note: { label: string; topic: NoteTopic; body: string; columns: string[] },
): TargetDraft {
  return new DraftBuilder({
    sectionId, row, target: "plan_observation", recordId: noteOnRecord(ctx.book, note.body), label: note.label, fixed: noteFixed("manual"),
  })
    .put("topic", note.topic, note.columns)
    .put("body", note.body, note.columns)
    .build();
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

/** One tier's rows of a beneficiary set on record. */
function tierOnRecord(set: PlacedValue | undefined, tier: string): PlacedValue[] {
  return Array.isArray(set) ? set.filter((e) => (e as { tier?: PlacedValue } | null)?.tier === tier) : [];
}

/**
 * A record's beneficiaries (D6): a second line hanging off `owner` (an
 * account, a life policy, a trust). A filled tier replaces that tier; a blank
 * tier keeps its rows on record (a blank never erases). A name that doesn't
 * resolve blocks this line only. Null when no tier is filled.
 */
export function beneficiariesOf(
  owner: DraftBuilder,
  row: FFRow,
  ctx: PlaceContext,
  set: {
    target: "account_beneficiary_designation" | "life_insurance_policy_beneficiary" | "trust_beneficiary_designation";
    tiers: readonly (readonly [tier: string, columnId: string])[];
    recordId: string | null;
    label: string;
    /** On a new record: what its set replaces. */
    newWarning?: string;
  },
): TargetDraft | null {
  const { target, tiers, recordId, label, newWarning } = set;
  const filled = tiers.filter(([, columnId]) => text(row, columnId) !== null);
  if (filled.length === 0) return null;
  const b = new DraftBuilder({ sectionId: owner.sectionId, row, target, recordId, label: `${label} — beneficiaries`, parent: owner.ref });
  const recorded = findRecord(ctx.book, target, recordId)?.values.beneficiaries;
  const entries: PlacedValue[] = [];
  for (const [tier, columnId] of tiers) {
    const names = text(row, columnId);
    if (names === null) {
      entries.push(...tierOnRecord(recorded, tier));
      continue;
    }
    const shares = sharesOf(names, ctx, ["household", "family", "external", "trust"]);
    if (!shares.ok) return b.block(shares.reason, columnId).build();
    entries.push(...shares.shares.map((s) => ({ tier, who: s.who, percentage: s.percent })));
  }
  b.put("beneficiaries", entries, filled.map(([, columnId]) => columnId));
  // Every record on the plan has a set, often empty — warn only when it names someone.
  if (recordId === null) {
    if (newWarning) b.warn(newWarning);
  } else if (Array.isArray(recorded) && recorded.length > 0) {
    b.warn("These beneficiaries replace the ones on record.", { field: "beneficiaries" });
  }
  return b.build();
}
