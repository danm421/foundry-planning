import type { Account } from "@/engine/types";
import { amortizeNote, type NoteYearRow } from "./note-amortization";

function schedule(account: Account): NoteYearRow[] {
  if (account.subType !== "promissory_note") return [];
  if (
    account.noteInterestRate == null ||
    account.noteTermMonths == null ||
    account.noteStartYear == null ||
    account.notePaymentType == null
  ) return [];
  return amortizeNote({
    principal: account.value,
    rate: account.noteInterestRate,
    termMonths: account.noteTermMonths,
    startYear: account.noteStartYear,
    paymentType: account.notePaymentType,
  });
}

export function noteIncomeForYear(account: Account, year: number): NoteYearRow | null {
  return schedule(account).find((r) => r.year === year) ?? null;
}

export function noteBalanceAtYear(account: Account, year: number): number {
  const rows = schedule(account);
  if (rows.length === 0) return account.value;
  if (year < rows[0].year) return account.value;
  const lastRow = rows[rows.length - 1];
  if (year >= lastRow.year) return lastRow.endingBalance;
  const row = rows.find((r) => r.year === year);
  return row ? row.endingBalance : account.value;
}
