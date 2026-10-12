// src/lib/fact-finder/types.ts
/**
 * Fact Finder Import — the stored state (`client_imports.payload_json.factFinder`)
 * and the reader → merge contract.
 *
 * A LEAF module: it imports nothing. `src/lib/imports/types.ts` imports it for
 * `ImportPayloadJson.factFinder`, and lib/fact-finder imports lib/imports at
 * runtime, so any import added here could close a cycle.
 */

export type FFCellValue = string | number | boolean | null;

/** Who last wrote a value. Advisor and chat writes always pin. */
export type FFActor = "document" | "advisor" | "chat";

export interface FFSource {
  fileId: string;
  page?: number;
  snippet?: string;
}

/** Why a document value is kept as text: it wouldn't parse, or isn't one of the options. */
export type FFCellIssue = "unparsed" | "notAnOption";

export interface FFCell {
  value: FFCellValue;
  source?: FFSource;
  /** 0..1. Below REVIEW_THRESHOLD a document value shows "check this". */
  confidence?: number;
  by: FFActor;
  /** Set by every advisor or chat write, including a clear. Readings never change a pinned cell. */
  pinned?: true;
  issue?: FFCellIssue;
}

export const HOLDING_FIELDS = ["ticker", "name", "shares", "price", "marketValue", "costBasis"] as const;
export type FFHoldingField = (typeof HOLDING_FIELDS)[number];

export interface FFHolding {
  id: string;
  ticker: string | null;
  name: string | null;
  shares: number | null;
  price: number | null;
  marketValue: number | null;
  costBasis: number | null;
  by: FFActor;
  pinned?: true;
  source?: FFSource;
}

/** A holding whose account couldn't be identified — the screen asks which account it belongs to. */
export interface FFUnassignedHolding extends FFHolding {
  accountHint: string;
}

export interface FFLinkCandidate {
  recordId: string;
  label: string;
  score: number;
}

export type FFLinkActor = "auto" | "advisor" | "chat";

/**
 * "Links to". An unconfirmed existing link is "74%?" on screen and blocks
 * review until the advisor confirms it or picks New.
 */
export type FFLink =
  | { kind: "existing"; recordId: string; score: number | null; confirmed: boolean; by: FFLinkActor }
  | { kind: "new"; by: FFLinkActor };

export interface FFRow {
  /** Minted at creation (or `${sectionId}:${label}` for fixed rows). Never derived from inputs. */
  id: string;
  /** Identity values captured from the reading that created the row, so an advisor edit to them can't break re-merging. */
  identity?: Record<string, FFCellValue>;
  cells: Record<string, FFCell>;
  link?: FFLink;
  linkCandidates?: FFLinkCandidate[];
  holdings?: FFHolding[];
  /** statementDate of the reading the holdings came from. */
  holdingsAsOf?: string;
  /** holdingKey()s the advisor removed; later readings never re-add them. */
  droppedHoldingKeys?: string[];
  sourceFileIds: string[];
  /** Newest statement date that fed this row (ISO yyyy-mm-dd). */
  statementDate?: string;
}

export interface FFRemoved {
  sectionId: string;
  row: FFRow;
  reason: string;
  by: FFActor;
  at: string;
  /** Later readings of the same row that were held back because it was removed. */
  absorbed?: number;
  /** Set when the row was merged into another; later readings of it update that row. */
  mergedInto?: string;
}

export type FFReader = "form" | "statement" | "section";

export interface FFFileReading {
  status: "reading" | "done" | "failed";
  reader?: FFReader;
  startedAt: string;
  finishedAt?: string;
  rows?: number;
  reason?: string;
  warnings?: string[];
}

export type FFChatTurn =
  | { id: string; role: "user"; text: string; at: string }
  | { id: string; role: "assistant"; text: string; at: string }
  | { id: string; role: "tool"; tool: string; summary: string; at: string };

/** Where a row sits, for undo. `null` = the row doesn't exist. */
export type FFRowLocation =
  | { where: "section"; sectionId: string; index: number; row: FFRow }
  | { where: "removed"; entry: FFRemoved }
  | null;

export type FFSnapshot =
  | { kind: "row"; rowId: string; before: FFRowLocation; after: FFRowLocation }
  | { kind: "unassigned"; before: FFUnassignedHolding[]; after: FFUnassignedHolding[] };

export interface FactFinderState {
  /** Bumped by every successful write (persist.ts owns it). */
  version: number;
  /** Rows per section id, in display order. */
  sections: Record<string, FFRow[]>;
  /** The Removed tray. */
  removed: FFRemoved[];
  unassignedHoldings: FFUnassignedHolding[];
  transcript: FFChatTurn[];
  /** Undo snapshots per chat turn id (Plan 2). */
  undo: Record<string, FFSnapshot[]>;
  /** Per uploaded file id. */
  readings: Record<string, FFFileReading>;
}

// ---- reader → merge contract -------------------------------------------------

export interface FFReadCell {
  value: FFCellValue;
  confidence: number;
  source: FFSource;
  issue?: FFCellIssue;
}

export interface FFReadHolding {
  ticker?: string;
  name?: string;
  shares?: number;
  price?: number;
  marketValue?: number;
  costBasis?: number;
}

/** One row as a reader saw it. Readers never touch the fact finder directly. */
export interface FFReading {
  sectionId: string;
  /** fixedRows / notes sections: which fixed row ("Client", "Notes"…). */
  fixedRow?: string;
  fileId: string;
  cells: Record<string, FFReadCell>;
  holdings?: FFReadHolding[];
  statementDate?: string;
  /** Arrives already excluded (e.g. a rollup total) — goes to the Removed tray with this reason. */
  exclude?: { reason: string };
}

export interface FFUnassignedReading {
  fileId: string;
  /** "Account (name or last 4)" as printed. */
  accountHint: string;
  holding: FFReadHolding;
  source: FFSource;
}

export interface FFReaderOutput {
  readings: FFReading[];
  unassignedHoldings: FFUnassignedReading[];
  warnings: string[];
}

export type FFMergeDecision =
  | { kind: "added"; sectionId: string; rowId: string; label: string; fileId: string }
  | { kind: "updated"; sectionId: string; rowId: string; label: string; fileId: string; columns: string[] }
  | { kind: "keptRemoved"; sectionId: string; rowId: string; label: string; fileId: string }
  | { kind: "excluded"; sectionId: string; rowId: string; label: string; fileId: string; reason: string }
  | { kind: "holdingUnassigned"; fileId: string; accountHint: string };
