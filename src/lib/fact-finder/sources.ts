// src/lib/fact-finder/sources.ts
/** Stamps "Claude read this in <document>" onto cells; Foundry never holds those statement files. */
import { isBlank } from "./state";
import { CLAUDE_FILE_ID, type FactFinderState, type FFRow } from "./types";

const QUOTE_MAX = 200;

export interface SourceStamp {
  sectionId: string;
  rowId: string;
  columnId: string;
  documentName: string;
  page?: number;
  quote?: string;
}

/** Cites a document on each named cell that holds a value; a stamp for an empty cell or a missing row is ignored. Untouched rows keep their identity. */
export function stampSources(state: FactFinderState, stamps: readonly SourceStamp[]): FactFinderState {
  const sections = { ...state.sections };
  const copied = new Set<string>();
  for (const { sectionId, rowId, columnId, documentName, page, quote } of stamps) {
    const rows = sections[sectionId];
    const index = rows?.findIndex((r) => r.id === rowId) ?? -1;
    const cell = index < 0 ? undefined : rows[index].cells[columnId];
    if (!cell || isBlank(cell.value)) continue;
    if (!copied.has(sectionId)) {
      sections[sectionId] = [...rows];
      copied.add(sectionId);
    }
    const row: FFRow = sections[sectionId][index];
    sections[sectionId][index] = {
      ...row,
      cells: {
        ...row.cells,
        [columnId]: { ...cell, source: { fileId: CLAUDE_FILE_ID, documentName, page, snippet: quote?.slice(0, QUOTE_MAX) } },
      },
    };
  }
  return copied.size === 0 ? state : { ...state, sections };
}
