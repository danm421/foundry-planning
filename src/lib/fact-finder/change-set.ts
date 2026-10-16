// src/lib/fact-finder/change-set.ts
/**
 * The change list the review builds (Plan 3) and the save writes (Plan 4):
 * ChangeSet → ChangeLine (one record write) → ChangeField (one value, shown
 * as "on record → new"). Stored as `factFinder.changeSet`; only the review
 * writes it, and a write that changes the rows or unassigned holdings drops it
 * (persist.ts).
 *
 * Client-safe: the screen renders it. Type-only imports.
 */
import type { FFPage } from "./schema";

/** The DETAIL_ENTITIES ids a change line can write. */
export const TARGET_KINDS = [
  "client_household", "plan_settings_tax_rates", "family_member", "external_beneficiary", "related_party",
  "account", "business_account", "account_beneficiary_designation", "annuity_contract",
  "stock_option_account", "stock_option_grant", "note_receivable", "liability",
  "income", "expense", "savings_rule",
  "life_insurance_policy", "life_insurance_policy_beneficiary", "disability_policy", "ltc_policy",
  "entity", "trust_beneficiary_designation", "revocable_trust",
  "will", "will_bequest", "will_residuary_recipient", "gift", "plan_observation",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/** Something a value refers to. Plan 4 turns a `line` ref into the id that line's record gets. */
export type RecordRef =
  | { ref: "record"; target: TargetKind; id: string }
  | { ref: "line"; target: TargetKind; lineId: string }
  | { ref: "person"; role: "client" | "spouse" };

/** A value in app terms: enum values, fractions, ISO dates, refs. */
export type PlacedValue = string | number | boolean | null | RecordRef | PlacedValue[] | { [key: string]: PlacedValue };

/** A fact finder cell — where a value came from, and where "Fix in fact finder" goes. */
export interface CellRef {
  sectionId: string;
  rowId: string;
  columnId: string;
}

export interface ChangeField {
  /** The target's field key (placement/targets.ts). */
  key: string;
  label: string;
  next: PlacedValue;
  /** Update lines: the value on record (null = empty). Plan 4's stale check compares it. */
  onRecord?: PlacedValue;
  shown: { next: string; onRecord?: string };
  /** The default tick. */
  ticked: boolean;
  from: CellRef[];
  /** Written with this field whenever it is ticked (e.g. growthSource "custom" with a growth rate). */
  with?: Record<string, PlacedValue>;
  /** Proposed by the leftovers step: the words it came from. */
  ai?: { quote: string };
}

export type ChangeAction = "create" | "update" | "none";

export interface ChangeLine {
  /** lineIdOf(rowId, target, n?) */
  id: string;
  page: FFPage;
  sectionId: string;
  rowId: string;
  target: TargetKind;
  action: ChangeAction;
  /** update / none: the record; create: null. */
  recordId: string | null;
  label: string;
  /** Create lines: values the section implies (category, income type…), written but not shown. */
  fixed?: Record<string, PlacedValue>;
  fields: ChangeField[];
  warnings: string[];
  blocked?: { reason: string; cell?: CellRef };
  /** The record this one hangs off: an annuity contract's account, a designation set's account or trust, a grant's stock option account, a bequest's will. */
  parent?: RecordRef;
  /** Create lines whose records this line refers to. */
  dependsOn?: string[];
  aiPlaced?: true;
}

export interface ChangeSet {
  /** The fact finder version the review wrote. Later writes that leave the rows alone keep the change set, so `version` can be higher. */
  builtAtVersion: number;
  /** ISO timestamp. */
  builtAt: string;
  lines: ChangeLine[];
  /** Change-set-wide: notes not placed, documents-in-place hints… */
  notices: string[];
  /**
   * Whether the plan had the co-client's family member when the review built the list — what it kept or left out
   * of the lines naming them. Absent on a list stored before the review recorded it.
   */
  hasCoClient?: boolean;
}

/** lineId → field key → ticked. */
export type ChangeTicks = Record<string, Record<string, boolean>>;

/** `${rowId}/${target}`, plus `/${n}` when one row makes several lines of one target. */
export function lineIdOf(rowId: string, target: TargetKind, n?: number): string {
  return n === undefined ? `${rowId}/${target}` : `${rowId}/${target}/${n}`;
}

/** lineIdOf's inverse: the row and target a line id names (and its n); null for an id lineIdOf doesn't make. */
export function parseLineId(lineId: string): { rowId: string; target: TargetKind; n?: number } | null {
  const m = /^(.*)\/([a-z_]+)(?:\/(\d+))?$/.exec(lineId);
  if (!m || !(TARGET_KINDS as readonly string[]).includes(m[2])) return null;
  return { rowId: m[1], target: m[2] as TargetKind, ...(m[3] !== undefined ? { n: Number(m[3]) } : {}) };
}

/** A fact finder cell's key: `${rowId}:${columnId}` (row ids are unique across sections). */
export const cellKey = (rowId: string, columnId: string): string => `${rowId}:${columnId}`;

/** What a ref names: a record by its id, a line by its id, a person by role. */
export function refKey(ref: RecordRef): string {
  return ref.ref === "record" ? `record:${ref.id}` : ref.ref === "line" ? `line:${ref.lineId}` : `person:${ref.role}`;
}

/** Two refs to the same record, line or person. */
export const sameRef = (a: RecordRef, b: RecordRef): boolean => refKey(a) === refKey(b);

export function isRecordRef(value: PlacedValue | undefined): value is RecordRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const knownTarget = (TARGET_KINDS as readonly unknown[]).includes(v.target);
  if (v.ref === "record") return knownTarget && typeof v.id === "string";
  if (v.ref === "line") return knownTarget && typeof v.lineId === "string";
  if (v.ref === "person") return v.role === "client" || v.role === "spouse";
  return false;
}

/** Default ticks: every field of every create/update line that isn't blocked. */
export function defaultTicks(changeSet: ChangeSet): ChangeTicks {
  const ticks: ChangeTicks = {};
  for (const line of changeSet.lines) {
    if (line.action === "none" || line.blocked) continue;
    ticks[line.id] = Object.fromEntries(line.fields.map((f) => [f.key, f.ticked]));
  }
  return ticks;
}

/** The lines to create, to update, unchanged, and that can't save — a blocked line counts only as blocked. */
export function countLines(lines: readonly ChangeLine[]): { creates: number; updates: number; unchanged: number; blocked: number } {
  const count = (keep: (line: ChangeLine) => boolean) => lines.filter(keep).length;
  return {
    creates: count((l) => !l.blocked && l.action === "create"),
    updates: count((l) => !l.blocked && l.action === "update"),
    unchanged: count((l) => !l.blocked && l.action === "none"),
    blocked: count((l) => l.blocked !== undefined),
  };
}
