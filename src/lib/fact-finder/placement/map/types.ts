// src/lib/fact-finder/placement/map/types.ts
/**
 * The section-map contract (D4): each fact finder section says where every one
 * of its columns goes, and turns its live rows into target drafts.
 */
import type { TargetKind } from "../../change-set";
import type { FactFinderState, FFRow } from "../../types";
import type { RefIndex } from "../refs";
import type { NoteTopic, RecordBook, TargetDraft } from "../types";

/** A target field (`${target}.${key}`, a TARGETS key), a note for the AI step, or read for context and never saved (why). */
export type Placement = { to: `${TargetKind}.${string}` } | { note: NoteTopic } | { context: string };

export interface PlaceContext {
  state: FactFinderState;
  book: RecordBook;
  refs: RefIndex;
  /** Meta → Date completed (ISO): the "as of" for values with no statement date. */
  asOf: string | null;
  /** The current year, for default start years. */
  year: number;
  /** A change-set-wide message (the runner collects them). */
  notice(text: string): void;
}

export interface SectionMap {
  sectionId: string;
  /** Every column of the section, exactly once. */
  placements: Readonly<Record<string, Placement>>;
  /** Drafts for the section's live rows (cells that didn't fit their column already removed). */
  place(rows: readonly FFRow[], ctx: PlaceContext): TargetDraft[];
}
