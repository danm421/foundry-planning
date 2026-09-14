// src/lib/entity-extraction/types.ts
import type { MatchAnnotation } from "@/lib/imports/types";

/** Why a placed value cannot be trusted as-is. Absent means it is clean. */
export type ValueIssue = "coercion" | "enum" | "range" | "ungrounded";

export interface Observation {
  key: string;
  value: unknown;
  /** Verbatim text the value was read from. Null when the model omitted it. */
  snippet: string | null;
  /** 0..1, as emitted by the model and then clamped by deterministic checks. */
  confidence: number;
  issue?: ValueIssue;
}

/** One row of a model response, before coercion. */
export type RawObservationRow = Record<
  string,
  { value: unknown; snippet?: string | null; confidence?: number }
>;

export interface CandidateRow {
  entityId: string;
  /** Stable within one import, so the review table can address a row. */
  rowId: string;
  values: Observation[];
  /** Required field keys no observation filled. Non-empty blocks acceptance. */
  missingRequired: string[];
  match?: MatchAnnotation;
  /** Lowest confidence across required and identity fields. */
  rowConfidence: number;
}

/**
 * Extracted rows keyed by entity id — one entry per entity that produced any.
 *
 * This is the wire shape of `/chat/map-pass` and the persisted shape of
 * `ChatState.entityRows`, so it is declared here beside `CandidateRow` rather
 * than in any one consumer: it crosses the server pass, the route, the page
 * and the browser hook, and a copy in a `"use client"` module would make a
 * server component import a type from a client file to describe its own data.
 */
export type RowsByEntity = Record<string, CandidateRow[]>;
