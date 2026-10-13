// src/lib/fact-finder/placement/types.ts
/**
 * The placement pipeline's own shapes: what a section map builds (TargetDraft),
 * what the diff reads the plan from (RecordBook), and what the AI step places
 * (LeftoverItem). Pure — no IO.
 */
import { TARGET_KINDS, type CellRef, type PlacedValue, type RecordRef, type TargetKind } from "../change-set";

/** plan_observations topics — equal to OBSERVATION_TOPICS in @/lib/schemas/observations (a test pins it). */
export const NOTE_TOPICS = ["retirement", "cash-flow", "investments", "tax", "insurance", "estate", "education", "general"] as const;
export type NoteTopic = (typeof NOTE_TOPICS)[number];

export interface DraftField {
  key: string;
  value: PlacedValue;
  from: CellRef[];
  with?: Record<string, PlacedValue>;
  /** Set by the leftovers step. */
  ai?: { quote: string };
}

/** One record write as a section map sees it, before the diff. */
export interface TargetDraft {
  lineId: string;
  sectionId: string;
  rowId: string;
  target: TargetKind;
  recordId: string | null;
  label: string;
  fixed?: Record<string, PlacedValue>;
  /** Never an empty value. */
  fields: DraftField[];
  warnings: string[];
  blocked?: { reason: string; cell?: CellRef };
  parent?: RecordRef;
  dependsOn?: string[];
  aiPlaced?: true;
}

/** A base-case record as the diff reads it: values under the same catalog keys and encoding the maps use. */
export interface BookRecord {
  id: string;
  label: string;
  values: Record<string, PlacedValue>;
  /** Lookups the maps need but never diff (an income's ownerAccountId, a grant's accountId…). */
  facts?: Record<string, string | number | boolean | null>;
}

export interface RecordBook {
  clientId: string;
  /** The base case; null = the client has none. */
  scenarioId: string | null;
  /** family_members ids, role client / spouse. */
  people: { client: string | null; spouse: string | null };
  /** First names on record. */
  names: { client: string | null; spouse: string | null };
  records: Record<TargetKind, BookRecord[]>;
}

/** A book with no records: what a client with no base case reviews against, and what the loader fills. */
export function emptyRecordBook(clientId: string): RecordBook {
  return {
    clientId,
    scenarioId: null,
    people: { client: null, spouse: null },
    names: { client: null, spouse: null },
    records: Object.fromEntries(TARGET_KINDS.map((target) => [target, [] as BookRecord[]])) as Record<TargetKind, BookRecord[]>,
  };
}

/** Free text the AI step places: a notes column, a notes box, or a value that didn't fit its column. */
export interface LeftoverItem {
  /** `${rowId}:${columnId}` */
  id: string;
  cell: CellRef;
  text: string;
  kind: "note" | "unfit";
  topic: NoteTopic;
  columnLabel: string;
  rowLabel: string;
}
