import {
  calcOriginalBalance,
  computeAmortizationSchedule,
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

  const raw = computeAmortizationSchedule(
    originalBalance,
    note.interestRate,
    monthlyPayment,
    note.startYear,
    note.termMonths,
    extras,
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
 */
function buildInterestOnlyBalloonSchedule(
  note: NoteReceivable,
): NoteScheduleRow[] {
  const rows: NoteScheduleRow[] = [];
  const endYear = note.startYear + Math.ceil(note.termMonths / 12) - 1;
  let balance = note.faceValue;
  for (let y = note.startYear; y <= endYear; y++) {
    const interest = balance * note.interestRate;
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
