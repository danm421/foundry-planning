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
