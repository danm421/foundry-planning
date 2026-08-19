import {
  calcOriginalBalance,
  computeAmortizationSchedule,
  monthsInOriginationYear,
  scheduleEndYear,
  type ScheduleExtraPayment,
} from "@/lib/loan-math";
import type { NoteReceivable, NoteScheduleRow, NoteScheduleMap } from "./types";

/**
 * Monthly payment used by `computeAmortizationSchedule` to amortize the note.
 * Falls back to the standard amortization formula on the face value when the
 * user has not stored an explicit monthlyPayment. For interest_only_balloon
 * notes, the monthly payment is the monthly interest on the face value — the
 * balloon principal is added separately in the final period.
 */
function monthlyPaymentFor(note: NoteReceivable): number {
  if (note.monthlyPayment != null && note.monthlyPayment > 0) {
    return note.monthlyPayment;
  }
  if (note.paymentType === "interest_only_balloon") {
    return (note.faceValue * note.interestRate) / 12;
  }
  const r = note.interestRate / 12;
  const n = note.termMonths;
  if (r === 0) return note.faceValue / n;
  return (note.faceValue * r) / (1 - Math.pow(1 + r, -n));
}

/**
 * Year-by-year amortization for a note receivable, starting at its origination
 * year. When `asOfBalance` is supplied we back-calculate the original principal
 * (mirrors `buildLiabilitySchedule`) so the schedule covers every year from
 * loan start through payoff. Returns scheduledPayment as the sum of contractual
 * payment plus any extra payment applied that year.
 */
export function buildNoteReceivableSchedule(
  note: NoteReceivable,
): NoteScheduleRow[] {
  const monthlyPayment = monthlyPaymentFor(note);

  if (note.paymentType === "interest_only_balloon") {
    return buildInterestOnlyBalloonSchedule(note);
  }

  const asOfMonth = note.balanceAsOfMonth ?? note.startMonth;
  const asOfYear = note.balanceAsOfYear ?? note.startYear;
  const elapsedMonths = Math.max(
    0,
    (asOfYear - note.startYear) * 12 + (asOfMonth - note.startMonth),
  );
  const originalBalance =
    note.asOfBalance != null && elapsedMonths > 0
      ? calcOriginalBalance(
          note.asOfBalance,
          note.interestRate,
          monthlyPayment,
          elapsedMonths,
        )
      : note.faceValue;

  const extras: ScheduleExtraPayment[] = note.extraPayments.map((ep) => ({
    year: ep.year,
    type: ep.type,
    amount: ep.amount,
  }));

  // startMonth is the note's own field, already read above to date the
  // asOfBalance. Omitting it here modelled every note as originating in
  // January: the origination year collected twelve payments instead of the
  // `13 - startMonth` it really holds, and the schedule ran out of window
  // before the term was up, so the routine's rounding-dust step dumped the
  // unpaid remainder into the last year as one invented balloon.
  const raw = computeAmortizationSchedule(
    originalBalance,
    note.interestRate,
    monthlyPayment,
    note.startYear,
    note.termMonths,
    extras,
    note.startMonth,
  );

  return raw.map((r) => ({
    year: r.year,
    beginningBalance: r.beginningBalance,
    scheduledPayment: r.payment + r.extraPayment,
    interest: r.interest,
    principal: r.principal + r.extraPayment,
    endingBalance: r.endingBalance,
  }));
}

/**
 * Interest-only with balloon at the end of the term. Each non-final year pays
 * only interest on the outstanding face value; the final year repays the full
 * principal plus that year's interest.
 *
 * A calendar year is charged only for the months of the term that fall inside
 * it, so an October note accrues three months of interest in its first year
 * and nine in its last — not twelve in each. The amortizing path has always
 * prorated both ends, because it simulates month by month. Billing a flat
 * twelve months per row also overcharged a January note whose term is not a
 * whole number of years: a 30-month note was charged 36 months of interest. A
 * January note with a whole-year term is unchanged.
 */
function buildInterestOnlyBalloonSchedule(
  note: NoteReceivable,
): NoteScheduleRow[] {
  const rows: NoteScheduleRow[] = [];
  // Shared with computeAmortizationSchedule rather than hand-copied: this was
  // the last remaining copy of that expression, and it had disagreed with the
  // schedule's own window since scheduleEndYear started honouring startMonth.
  const endYear = scheduleEndYear(note.startYear, note.termMonths, note.startMonth);
  let balance = note.faceValue;
  let monthsRemaining = note.termMonths;
  for (let y = note.startYear; y <= endYear; y++) {
    const monthsThisYear = Math.min(
      monthsRemaining,
      y === note.startYear ? monthsInOriginationYear(note.startMonth) : 12,
    );
    monthsRemaining -= monthsThisYear;
    const interest = balance * note.interestRate * (monthsThisYear / 12);
    const principal = y === endYear ? balance : 0;
    rows.push({
      year: y,
      beginningBalance: balance,
      scheduledPayment: interest + principal,
      interest,
      principal,
      endingBalance: balance - principal,
    });
    balance -= principal;
  }
  return rows;
}

export function buildNoteReceivableSchedules(
  notes: NoteReceivable[],
): NoteScheduleMap {
  const map: NoteScheduleMap = new Map();
  for (const note of notes) {
    map.set(note.id, buildNoteReceivableSchedule(note));
  }
  return map;
}
