// src/lib/fact-finder/worksheet/types.ts
/**
 * The worksheet: AI-built tables the advisor edits beside the chat. A LEAF
 * module — type-only imports, so `../types` can import it back without a cycle.
 */
import type { FFHoldingField } from "../types";

export type WsBinding =
  | { kind: "cell"; columnId: string } // staging cell; on a holding row, the account row's cell
  | { kind: "holding"; field: FFHoldingField } // holding rows only
  | { kind: "section" }; // the staging section's label (read-only)

export interface WsColumn {
  id: string;
  header: string;
  bind?: WsBinding;
}

export interface WsRowRef {
  rowId: string;
  holdingId?: string;
}

export interface WsSource {
  fileId: string;
  page?: number;
}

export interface WsRow {
  id: string;
  cells: Record<string, string>;
  ref?: WsRowRef;
  source?: WsSource;
}

export interface WsTable {
  id: string;
  title: string;
  note?: string;
  columns: WsColumn[];
  rows: WsRow[];
}

/** `derived`: built from staging on read, never edited — rebuilt on every read until the first worksheet op. */
export interface Worksheet {
  tables: WsTable[];
  composedFileIds: string[];
  derived?: true;
}
