import { describe, it, expect } from "vitest";
import { buildNoteReceivableSchedule, buildNoteReceivableSchedules } from "../note-schedules";
import { scheduleEndYear } from "@/lib/loan-math";
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

// ---------------------------------------------------------------------------
// Mid-year origination. Every note above starts in January, so none of them
// can see a note that ignores its own startMonth. NoteReceivable has carried a
// startMonth since day one; neither schedule builder ever used it.
// ---------------------------------------------------------------------------

/** $100k @ 5% over 24 months — the payment that exactly amortizes the note. */
const PMT_24 = 4387.14;

/** Oct 2026 + 24 months runs through Sep 2028, not Dec 2027. */
const octAmortizing: NoteReceivable = {
  ...baseNote,
  startMonth: 10,
  termMonths: 24,
  monthlyPayment: PMT_24,
};

describe("buildNoteReceivableSchedule — amortizing note honours its startMonth", () => {
  it("runs through the calendar year its term actually ends in", () => {
    const schedule = buildNoteReceivableSchedule(octAmortizing);
    expect(schedule[schedule.length - 1].year).toBe(2028);
    expect(schedule[schedule.length - 1].endingBalance).toBeCloseTo(0, 0);
  });

  it("books only the payments the origination year actually contains", () => {
    const schedule = buildNoteReceivableSchedule(octAmortizing);
    // Oct–Dec 2026 is three payments, not twelve.
    expect(schedule[0].scheduledPayment).toBeCloseTo(PMT_24 * 3, 2);
  });

  it("collects exactly the contractual number of payments", () => {
    const schedule = buildNoteReceivableSchedule(octAmortizing);
    const total = schedule.reduce((s, r) => s + r.scheduledPayment, 0);
    expect(total).toBeCloseTo(PMT_24 * 24, 0);
  });
});

describe("buildNoteReceivableSchedule — interest-only balloon honours its startMonth", () => {
  const octBalloon: NoteReceivable = {
    ...baseNote,
    paymentType: "interest_only_balloon",
    startMonth: 10,
    termMonths: 24,
  };

  it("fires the balloon in the year the note actually matures", () => {
    const schedule = buildNoteReceivableSchedule(octBalloon);
    const last = schedule[schedule.length - 1];
    expect(last.year).toBe(2028);
    expect(last.principal).toBeCloseTo(100_000, 0);
    expect(last.endingBalance).toBeCloseTo(0, 0);
  });

  it("accrues only the months the origination year actually contains", () => {
    const schedule = buildNoteReceivableSchedule(octBalloon);
    // Oct–Dec 2026 is a quarter of a year: $100k × 5% × 3/12.
    expect(schedule[0].interest).toBeCloseTo(1_250, 2);
  });

  it("accrues only the months remaining in the maturity year", () => {
    const schedule = buildNoteReceivableSchedule(octBalloon);
    // Jan–Sep 2028 is three quarters of a year: $100k × 5% × 9/12.
    expect(schedule[schedule.length - 1].interest).toBeCloseTo(3_750, 2);
  });

  it("charges interest for the note's term, not a whole number of years", () => {
    // A JANUARY note proves this is not only a mid-year problem: a 30-month
    // term is two and a half years of interest, and the third calendar year
    // holds six months of it — not twelve.
    const jan30 = { ...baseNote, paymentType: "interest_only_balloon" as const, termMonths: 30 };
    const schedule = buildNoteReceivableSchedule(jan30);
    const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
    expect(totalInterest).toBeCloseTo(100_000 * 0.05 * (30 / 12), 2);
  });

  it("bounds its window with the shared scheduleEndYear helper", () => {
    // Guards against a hand-copy of the window expression creeping back in.
    // The copy that used to live here disagreed with loan-math the moment
    // scheduleEndYear started honouring startMonth.
    for (const startMonth of [1, 4, 7, 10, 12]) {
      for (const termMonths of [1, 12, 18, 24, 30, 120]) {
        const note = {
          ...baseNote,
          paymentType: "interest_only_balloon" as const,
          startMonth,
          termMonths,
        };
        const schedule = buildNoteReceivableSchedule(note);
        expect(schedule[schedule.length - 1].year).toBe(
          scheduleEndYear(note.startYear, termMonths, startMonth),
        );
      }
    }
  });
});
