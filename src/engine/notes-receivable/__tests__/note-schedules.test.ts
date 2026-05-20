import { describe, it, expect } from "vitest";
import { buildNoteReceivableSchedule, buildNoteReceivableSchedules } from "../note-schedules";
import type { NoteReceivable } from "../types";

const baseNote: NoteReceivable = {
  id: "n1",
  name: "Test Note",
  faceValue: 100_000,
  basis: 40_000,
  interestRate: 0.05,
  paymentType: "amortizing",
  startYear: 2026,
  startMonth: 1,
  termMonths: 120,
  extraPayments: [],
  owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 100 }],
};

describe("buildNoteReceivableSchedule", () => {
  it("returns rows summing principal to faceValue across the term (amortizing, no extras)", () => {
    const schedule = buildNoteReceivableSchedule(baseNote);
    const totalPrincipal = schedule.reduce((s, r) => s + r.principal, 0);
    expect(totalPrincipal).toBeCloseTo(100_000, 0);
    expect(schedule[schedule.length - 1].endingBalance).toBeCloseTo(0, 0);
  });

  it("starts at the note's startYear", () => {
    const schedule = buildNoteReceivableSchedule(baseNote);
    expect(schedule[0].year).toBe(2026);
  });

  it("uses asOfBalance + balanceAsOfYear to back-calculate origination when supplied", () => {
    const noteMidLife: NoteReceivable = {
      ...baseNote,
      startYear: 2024,
      asOfBalance: 85_000,
      balanceAsOfMonth: 1,
      balanceAsOfYear: 2026,
    };
    const schedule = buildNoteReceivableSchedule(noteMidLife);
    const row2026 = schedule.find((r) => r.year === 2026);
    expect(row2026).toBeDefined();
    expect(row2026!.beginningBalance).toBeCloseTo(85_000, -2);
  });

  it("applies lump_sum extra payment within the target year, accelerating payoff", () => {
    const noteWithLump: NoteReceivable = {
      ...baseNote,
      extraPayments: [
        { id: "e1", noteReceivableId: "n1", year: 2027, type: "lump_sum", amount: 20_000 },
      ],
    };
    const schedule = buildNoteReceivableSchedule(noteWithLump);
    const baseline = buildNoteReceivableSchedule(baseNote);
    const target = schedule.find((r) => r.year === 2027)!;
    const baselineTarget = baseline.find((r) => r.year === 2027)!;
    expect(target.endingBalance).toBeLessThan(baselineTarget.endingBalance - 19_000);
  });

  it("applies per_payment extra to every monthly payment in the target year", () => {
    const noteWithPer: NoteReceivable = {
      ...baseNote,
      extraPayments: [
        { id: "e1", noteReceivableId: "n1", year: 2027, type: "per_payment", amount: 500 },
      ],
    };
    const schedule = buildNoteReceivableSchedule(noteWithPer);
    const baseline = buildNoteReceivableSchedule(baseNote);
    const target = schedule.find((r) => r.year === 2027)!;
    const baselineTarget = baseline.find((r) => r.year === 2027)!;
    expect(target.endingBalance).toBeLessThan(baselineTarget.endingBalance - 5_500);
  });

  it("handles interest_only_balloon: each year is interest only until the final year", () => {
    const noteIOB: NoteReceivable = { ...baseNote, paymentType: "interest_only_balloon" };
    const schedule = buildNoteReceivableSchedule(noteIOB);
    // First 9 years: principal ~ 0
    for (let i = 0; i < schedule.length - 1; i++) {
      expect(schedule[i].principal).toBeCloseTo(0, 0);
    }
    // Final year: principal ~ faceValue
    expect(schedule[schedule.length - 1].principal).toBeCloseTo(100_000, 0);
  });
});

describe("buildNoteReceivableSchedules", () => {
  it("returns a Map keyed by note id", () => {
    const map = buildNoteReceivableSchedules([baseNote]);
    expect(map.get("n1")).toBeDefined();
    expect(map.size).toBe(1);
  });
});
