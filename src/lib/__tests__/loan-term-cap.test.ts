// Loan and note terms top out at 12,000 months (1,000 years). Every write
// schema rejects a longer term, and the schedule builders stop at that bound so
// a row stored before the limit existed still yields a finite schedule. Saved
// terms run up to 3,240 months, so every one of them stays valid.
import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { liabilityCreateSchema, liabilityUpdateSchema } from "@/lib/schemas/liabilities";
import {
  noteReceivableCreateSchema,
  noteReceivableUpdateSchema,
} from "@/lib/schemas/note-receivable";
import { computeAmortizationSchedule } from "@/lib/loan-math";
import { buildLiabilitySchedule } from "@/engine/liability-schedules";
import { buildNoteReceivableSchedule } from "@/engine/notes-receivable/note-schedules";
import type { Liability } from "@/engine/types";
import type { NoteReceivable } from "@/engine/notes-receivable/types";

const CAP = 12_000;
const LONGEST_REAL_TERM = 3_240;
// One year past the limit: long enough to show the bound, short enough that a
// builder without the bound still finishes instantly.
const PAST_CAP = CAP + 12;

const liability: Liability = {
  id: "liab-1",
  name: "Mortgage",
  balance: 250_000,
  interestRate: 0.0625,
  monthlyPayment: 1_800,
  startYear: 2026,
  startMonth: 1,
  termMonths: 360,
  extraPayments: [],
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

const note: NoteReceivable = {
  id: "note-1",
  name: "Seller note",
  faceValue: 500_000,
  basis: 200_000,
  interestRate: 0.05,
  paymentType: "amortizing",
  startYear: 2026,
  startMonth: 1,
  termMonths: 120,
  extraPayments: [],
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

const noteCreateBody = {
  name: "Seller note",
  faceValue: 500_000,
  basis: 200_000,
  interestRate: 0.05,
  paymentType: "amortizing",
  startYear: 2026,
  termMonths: 120,
  owners: [{ familyMemberId: "11111111-1111-1111-1111-111111111111", percent: 1 }],
};

const TOO_LONG = [CAP + 1, Number.MAX_SAFE_INTEGER];
const ALLOWED = [LONGEST_REAL_TERM, CAP];

describe("Solver changes cap a loan or note term at 12,000 months", () => {
  const liabilityUpsert = (termMonths: number) =>
    SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "liability-upsert",
      id: liability.id,
      value: { ...liability, termMonths },
    }).success;
  const noteUpsert = (termMonths: number) =>
    SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "note-receivable-upsert",
      id: note.id,
      value: { ...note, termMonths },
    }).success;

  it.each(TOO_LONG)("rejects a %d-month liability term", (t) => {
    expect(liabilityUpsert(t)).toBe(false);
  });
  it.each(ALLOWED)("accepts a %d-month liability term", (t) => {
    expect(liabilityUpsert(t)).toBe(true);
  });
  it.each(TOO_LONG)("rejects a %d-month note term", (t) => {
    expect(noteUpsert(t)).toBe(false);
  });
  it.each(ALLOWED)("accepts a %d-month note term", (t) => {
    expect(noteUpsert(t)).toBe(true);
  });
});

describe("liability create and edit cap the term at 12,000 months", () => {
  const create = (termMonths: unknown) =>
    liabilityCreateSchema.safeParse({ name: "Mortgage", startYear: 2026, termMonths }).success;
  const update = (termMonths: unknown) => liabilityUpdateSchema.safeParse({ termMonths }).success;

  it.each(TOO_LONG)("create rejects a %d-month term", (t) => {
    expect(create(t)).toBe(false);
    expect(create(String(t))).toBe(false);
  });
  it.each(ALLOWED)("create accepts a %d-month term", (t) => {
    expect(create(t)).toBe(true);
    expect(create(String(t))).toBe(true);
  });
  it.each(TOO_LONG)("edit rejects a %d-month term", (t) => {
    expect(update(t)).toBe(false);
  });
  it.each(ALLOWED)("edit accepts a %d-month term", (t) => {
    expect(update(t)).toBe(true);
  });
  it("edit still leaves an omitted term absent", () => {
    const r = liabilityUpdateSchema.safeParse({ name: "Renamed" });
    expect(r.success && "termMonths" in r.data).toBe(false);
  });
});

describe("note create and edit cap the term at 12,000 months", () => {
  const create = (termMonths: number) =>
    noteReceivableCreateSchema.safeParse({ ...noteCreateBody, termMonths }).success;
  const update = (termMonths: number) =>
    noteReceivableUpdateSchema.safeParse({ termMonths }).success;

  it.each(TOO_LONG)("create rejects a %d-month term", (t) => {
    expect(create(t)).toBe(false);
  });
  it.each(ALLOWED)("create accepts a %d-month term", (t) => {
    expect(create(t)).toBe(true);
  });
  it.each(TOO_LONG)("edit rejects a %d-month term", (t) => {
    expect(update(t)).toBe(false);
  });
  it.each(ALLOWED)("edit accepts a %d-month term", (t) => {
    expect(update(t)).toBe(true);
  });
});

// A balance of 1 at 0% with no payment never pays down, so the schedule runs to
// its window's end — the row count is exactly the number of years it covers.
describe("schedule builders stop at 12,000 months", () => {
  const yearsAtCap = CAP / 12;

  it("computeAmortizationSchedule", () => {
    const atCap = computeAmortizationSchedule(1, 0, 0, 2026, CAP, [], 1);
    const pastCap = computeAmortizationSchedule(1, 0, 0, 2026, PAST_CAP, [], 1);
    expect(atCap).toHaveLength(yearsAtCap);
    expect(pastCap).toHaveLength(yearsAtCap);
    // The balance still comes due in the last year rather than hanging open.
    expect(pastCap[pastCap.length - 1].endingBalance).toBe(0);
  });

  it("buildLiabilitySchedule", () => {
    const rows = buildLiabilitySchedule({
      ...liability,
      balance: 1,
      interestRate: 0,
      monthlyPayment: 0,
      termMonths: PAST_CAP,
    });
    expect(rows).toHaveLength(yearsAtCap);
  });

  it("buildNoteReceivableSchedule, amortizing", () => {
    const rows = buildNoteReceivableSchedule({
      ...note,
      faceValue: 1,
      interestRate: 0,
      termMonths: PAST_CAP,
    });
    expect(rows).toHaveLength(yearsAtCap);
  });

  it("buildNoteReceivableSchedule, interest only with a balloon", () => {
    const rows = buildNoteReceivableSchedule({
      ...note,
      paymentType: "interest_only_balloon",
      faceValue: 1,
      interestRate: 0,
      termMonths: PAST_CAP,
    });
    expect(rows).toHaveLength(yearsAtCap);
    expect(rows[rows.length - 1].principal).toBe(1);
  });
});
