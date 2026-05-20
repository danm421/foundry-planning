import { installmentSaleSplit } from "./tax-split";
import type {
  NoteReceivable,
  NoteScheduleMap,
  NotesReceivableResult,
  NoteYearResult,
} from "./types";

const ZERO_YEAR_RESULT: NoteYearResult = {
  interest: 0,
  principalLTCG: 0,
  principalBasis: 0,
  totalCashIn: 0,
  endingBalance: 0,
};

export function computeNotesReceivable(
  notes: NoteReceivable[],
  scheduleMap: NoteScheduleMap,
  year: number,
  filter?: (note: NoteReceivable) => boolean,
): NotesReceivableResult {
  const byNote = new Map<string, NoteYearResult>();
  const totals: NoteYearResult = { ...ZERO_YEAR_RESULT };

  for (const note of notes) {
    if (filter && !filter(note)) continue;
    const schedule = scheduleMap.get(note.id) ?? [];
    const row = schedule.find((r) => r.year === year);
    if (!row || row.scheduledPayment === 0) continue;

    const { ltcg, basisRecovery } = installmentSaleSplit(
      note.faceValue,
      note.basis,
      row.principal,
    );

    const yr: NoteYearResult = {
      interest: row.interest,
      principalLTCG: ltcg,
      principalBasis: basisRecovery,
      totalCashIn: row.scheduledPayment,
      endingBalance: row.endingBalance,
    };
    byNote.set(note.id, yr);
    totals.interest += yr.interest;
    totals.principalLTCG += yr.principalLTCG;
    totals.principalBasis += yr.principalBasis;
    totals.totalCashIn += yr.totalCashIn;
    totals.endingBalance += yr.endingBalance;
  }

  return { byNote, totals, updatedNotes: notes };
}

export function amortizeNoteReceivable(
  note: NoteReceivable,
  scheduleMap: NoteScheduleMap,
  year: number,
): NoteYearResult {
  const result = computeNotesReceivable([note], scheduleMap, year);
  return result.byNote.get(note.id) ?? { ...ZERO_YEAR_RESULT };
}
