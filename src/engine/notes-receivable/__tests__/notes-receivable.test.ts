import { describe, it, expect } from "vitest";
import { computeNotesReceivable } from "../notes-receivable";
import { buildNoteReceivableSchedules } from "../note-schedules";
import type { NoteReceivable } from "../types";

const baseNote: NoteReceivable = {
  id: "n1",
  name: "Test Note",
  faceValue: 100_000,
  basis: 40_000,           // 60% gain share
  interestRate: 0.05,
  paymentType: "amortizing",
  startYear: 2026,
  startMonth: 1,
  termMonths: 120,
  extraPayments: [],
  owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 100 }],
};

describe("computeNotesReceivable", () => {
  it("returns zeros for a year before the note starts", () => {
    const schedule = buildNoteReceivableSchedules([baseNote]);
    const result = computeNotesReceivable([baseNote], schedule, 2025);
    expect(result.totals.totalCashIn).toBe(0);
    expect(result.totals.interest).toBe(0);
  });

  it("splits a regular-year payment into interest + LTCG + basis pro-rata", () => {
    const schedule = buildNoteReceivableSchedules([baseNote]);
    const result = computeNotesReceivable([baseNote], schedule, 2026);
    const r = result.byNote.get("n1")!;
    expect(r.interest).toBeGreaterThan(4_000);
    const totalPrincipal = r.principalLTCG + r.principalBasis;
    expect(r.principalLTCG / totalPrincipal).toBeCloseTo(0.6, 4);
    expect(r.principalBasis / totalPrincipal).toBeCloseTo(0.4, 4);
    expect(r.totalCashIn).toBeCloseTo(r.interest + totalPrincipal, 4);
  });

  it("aggregates totals across all notes", () => {
    const noteB: NoteReceivable = { ...baseNote, id: "n2", faceValue: 50_000, basis: 50_000 };
    const schedule = buildNoteReceivableSchedules([baseNote, noteB]);
    const result = computeNotesReceivable([baseNote, noteB], schedule, 2026);
    const a = result.byNote.get("n1")!;
    const b = result.byNote.get("n2")!;
    expect(result.totals.interest).toBeCloseTo(a.interest + b.interest, 4);
    expect(result.totals.totalCashIn).toBeCloseTo(a.totalCashIn + b.totalCashIn, 4);
  });

  it("respects an optional filter predicate", () => {
    const schedule = buildNoteReceivableSchedules([baseNote]);
    const result = computeNotesReceivable(
      [baseNote],
      schedule,
      2026,
      (n) => n.id === "other",
    );
    expect(result.totals.totalCashIn).toBe(0);
    expect(result.byNote.size).toBe(0);
  });

  it("cumulative invariant: across the full term, total LTCG = faceValue - basis", () => {
    const schedule = buildNoteReceivableSchedules([baseNote]);
    let totalLtcg = 0;
    let totalBasis = 0;
    for (let y = 2026; y <= 2036; y++) {
      const r = computeNotesReceivable([baseNote], schedule, y);
      const note = r.byNote.get("n1");
      if (note) {
        totalLtcg += note.principalLTCG;
        totalBasis += note.principalBasis;
      }
    }
    expect(totalLtcg).toBeCloseTo(60_000, 0);
    expect(totalBasis).toBeCloseTo(40_000, 0);
  });
});
