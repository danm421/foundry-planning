export type NotePaymentType = "amortizing" | "interest_only_balloon";

export interface AmortizeNoteInput {
  principal: number;
  rate: number;
  termMonths: number;
  startYear: number;
  paymentType: NotePaymentType;
}

export interface NoteYearRow {
  year: number;
  interest: number;
  principal: number;
  endingBalance: number;
}

export function amortizeNote(input: AmortizeNoteInput): NoteYearRow[] {
  const { principal, rate, termMonths, startYear, paymentType } = input;
  if (principal <= 0 || termMonths <= 0) return [];

  const termYears = Math.ceil(termMonths / 12);
  const monthlyRate = rate / 12;
  const rows: NoteYearRow[] = [];

  if (paymentType === "amortizing") {
    const monthlyPayment =
      monthlyRate === 0
        ? principal / termMonths
        : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths));

    let balance = principal;
    for (let y = 0; y < termYears; y++) {
      let yearInterest = 0;
      let yearPrincipal = 0;
      const monthsThisYear = y === termYears - 1 ? termMonths - y * 12 : 12;
      for (let m = 0; m < monthsThisYear; m++) {
        const interest = balance * monthlyRate;
        const pmt = Math.min(monthlyPayment, balance + interest);
        const principalPortion = pmt - interest;
        yearInterest += interest;
        yearPrincipal += principalPortion;
        balance -= principalPortion;
      }
      rows.push({
        year: startYear + y,
        interest: round2(yearInterest),
        principal: round2(yearPrincipal),
        endingBalance: round2(Math.max(0, balance)),
      });
    }
  } else {
    let balance = principal;
    for (let y = 0; y < termYears; y++) {
      const interest = balance * rate;
      const isFinal = y === termYears - 1;
      const principalPortion = isFinal ? balance : 0;
      balance -= principalPortion;
      rows.push({
        year: startYear + y,
        interest: round2(interest),
        principal: round2(principalPortion),
        endingBalance: round2(balance),
      });
    }
  }
  return rows;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
