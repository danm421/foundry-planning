// src/lib/fact-finder/placement/__tests__/fixtures.ts
/**
 * Builders for placement tests — fact finder rows, a fact finder, a record book
 * and a place context. Shared by the refs and helpers tests and every section
 * map's test (Tasks 5–12).
 */
import type { TargetKind } from "../../change-set";
import { emptyFactFinderState } from "../../state";
import type { FactFinderState, FFCellValue, FFLink, FFRow } from "../../types";
import type { PlaceContext } from "../map/types";
import { buildRefIndex } from "../refs";
import { emptyRecordBook, type BookRecord, type RecordBook } from "../types";

/** A row whose cells hold `values` as a document read them. */
export function rowOf(id: string, values: Record<string, FFCellValue>, extra: Partial<FFRow> = {}): FFRow {
  return {
    id,
    cells: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v, by: "document" as const, confidence: 0.9 }])),
    sourceFileIds: ["f1"],
    ...extra,
  };
}

/** A confirmed "Links to" an existing record. */
export const linkedTo = (recordId: string): FFLink => ({ kind: "existing", recordId, score: 1, confirmed: true, by: "advisor" });

/** An empty fact finder holding these rows (a fixed-row section's rows replace its empty ones). */
export function stateWith(sections: Record<string, FFRow[]>): FactFinderState {
  const s = emptyFactFinderState();
  return { ...s, sections: { ...s.sections, ...sections } };
}

export function recordOf(id: string, label: string, values: BookRecord["values"], facts?: BookRecord["facts"]): BookRecord {
  return { id, label, values, ...(facts ? { facts } : {}) };
}

/** Client "c1"'s base case holding these records. */
export function bookWith(
  records: Partial<Record<TargetKind, BookRecord[]>>,
  extra: Partial<Omit<RecordBook, "records">> = {},
): RecordBook {
  const book = emptyRecordBook("c1");
  return { ...book, scenarioId: "base", ...extra, records: { ...book.records, ...records } };
}

/** Mark and Laura Hendricks on record (family member ids fm-client / fm-spouse), plus these records. */
export function hendricksBook(records: Partial<Record<TargetKind, BookRecord[]>> = {}): RecordBook {
  return bookWith(
    {
      client_household: [
        recordOf("c1", "Mark & Laura Hendricks", { firstName: "Mark", lastName: "Hendricks", spouseName: "Laura", spouseLastName: "Hendricks" }),
      ],
      ...records,
    },
    { people: { client: "fm-client", spouse: "fm-spouse" }, names: { client: "Mark", spouse: "Laura" } },
  );
}

/** A place context over `state` and `book` (year 2026); `notices` collects what a map reports. */
export function contextOf(
  state: FactFinderState,
  book: RecordBook,
  opts: { asOf?: string | null; year?: number } = {},
): { ctx: PlaceContext; notices: string[] } {
  const notices: string[] = [];
  const ctx: PlaceContext = {
    state,
    book,
    refs: buildRefIndex(state, book),
    asOf: opts.asOf ?? null,
    year: opts.year ?? 2026,
    notice: (text) => {
      notices.push(text);
    },
  };
  return { ctx, notices };
}
