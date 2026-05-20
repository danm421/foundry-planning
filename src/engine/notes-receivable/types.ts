import type { AccountOwner } from "@/engine/ownership";

export type NotePaymentType = "amortizing" | "interest_only_balloon";
export type NoteExtraPaymentType = "per_payment" | "lump_sum";

export interface NoteExtraPayment {
  id: string;
  noteReceivableId: string;
  year: number;
  type: NoteExtraPaymentType;
  amount: number;
}

export interface NoteReceivable {
  id: string;
  name: string;
  faceValue: number;
  basis: number;
  asOfBalance?: number;
  balanceAsOfMonth?: number;
  balanceAsOfYear?: number;
  interestRate: number;
  paymentType: NotePaymentType;
  monthlyPayment?: number;
  startYear: number;
  startMonth: number;
  termMonths: number;
  linkedTrustEntityId?: string | null;
  extraPayments: NoteExtraPayment[];
  owners: AccountOwner[];
}

export interface NoteScheduleRow {
  year: number;
  beginningBalance: number;
  scheduledPayment: number;
  interest: number;
  principal: number;
  endingBalance: number;
}

export type NoteScheduleMap = Map<string, NoteScheduleRow[]>;

export interface NoteYearResult {
  interest: number;
  principalLTCG: number;
  principalBasis: number;
  totalCashIn: number;
  endingBalance: number;
}

export interface NotesReceivableResult {
  byNote: Map<string, NoteYearResult>;
  totals: NoteYearResult;
  updatedNotes: NoteReceivable[];
}
