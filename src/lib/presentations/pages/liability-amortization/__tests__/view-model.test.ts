import { describe, expect, it } from "vitest";
import type { ClientData, Liability } from "@/engine/types";
import { liabilityAmortizationSchedule } from "@/lib/loan-math";
import {
  FIRST_SHEET_ROWS,
  NEXT_SHEET_ROWS,
  buildLiabilityAmortizationData,
  estimateLiabilityAmortizationPageCount,
  liabilityAmortizationTocSections,
  paginateRows,
  selectedLoans,
} from "../view-model";
import {
  isLiabilityAmortizationUnconfigured,
  liabilityAmortizationOptionsSchema,
  summarizeLiabilityAmortizationOptions,
} from "../options-schema";

const TODAY = new Date(2026, 9, 8);

function loan(over: Partial<Liability>): Liability {
  return {
    id: "loan",
    name: "Loan",
    balance: 250_000,
    interestRate: 0.06,
    monthlyPayment: 1_800,
    startYear: 2021,
    startMonth: 3,
    termMonths: 360,
    extraPayments: [],
    owners: [],
    ...over,
  };
}

const mortgage = loan({ id: "mortgage", name: "Mortgage" });
const auto = loan({ id: "auto", name: "Car loan", balance: 22_000, monthlyPayment: 610, startYear: 2024, termMonths: 60 });
const card = loan({ id: "card", name: "Visa", balance: 4_000, liabilityType: "credit_card" });
const noTerm = loan({ id: "plaid", name: "Synced loan", termMonths: 0 });
const paidOff = loan({ id: "paid", name: "Old loan", balance: 0 });
const plan = { liabilities: [card, auto, noTerm, mortgage, paidOff] } as unknown as ClientData;

describe("selectedLoans", () => {
  it("prints every amortizing loan, largest balance first, when none are picked", () => {
    expect(selectedLoans(plan, { liabilityIds: null }).map((l) => l.id)).toEqual(["mortgage", "auto"]);
  });

  it("prints only the picked loans, skipping one the plan no longer has", () => {
    expect(selectedLoans(plan, { liabilityIds: ["auto", "deleted"] }).map((l) => l.id)).toEqual(["auto"]);
  });

  it("never prints a held-flat debt, even when picked", () => {
    expect(selectedLoans(plan, { liabilityIds: ["card", "plaid"] })).toEqual([]);
  });
});

describe("buildLiabilityAmortizationData", () => {
  const data = buildLiabilityAmortizationData(plan, { liabilityIds: null }, "Base Case", TODAY);
  const m = data.loans[0];

  it("draws the same schedule as the liability dialog's Amortization tab", () => {
    const schedule = liabilityAmortizationSchedule(mortgage, [], TODAY);
    const rows = m.sheets.flat();
    expect(rows.map((r) => r.year)).toEqual(schedule.map((r) => r.year));
    expect(rows.map((r) => r.endingBalance)).toEqual(schedule.map((r) => r.endingBalance));
    expect(m.totals.interest).toBeCloseTo(schedule.reduce((s, r) => s + r.interest, 0), 6);
  });

  it("marks this year's row and states the loan's key terms", () => {
    expect(m.sheets.flat().filter((r) => r.isCurrentYear).map((r) => r.year)).toEqual([2026]);
    expect(m.facts).toEqual([
      { label: "Balance", value: "$250,000" },
      { label: "Interest rate", value: "6%" },
      { label: "Monthly payment", value: "$1,800" },
      { label: "Paid off", value: String(m.sheets.flat().at(-1)!.year) },
    ]);
  });

  it("charts balance, cumulative interest and cumulative payments", () => {
    const [balance, interest, paid] = m.chartSpec.lines;
    expect(m.chartSpec.lines.map((l) => l.label)).toEqual(["Balance", "Cumulative interest", "Cumulative payments"]);
    expect(balance.values.at(-1)).toBe(0);
    expect(interest.values.at(-1)).toBeCloseTo(m.totals.interest, 6);
    expect(paid.values.at(-1)).toBeCloseTo(m.totals.payment + m.totals.extraPayment, 6);
    expect(m.chartSpec.stacks).toEqual([]);
  });

  it("totals a loan's extra payments", () => {
    expect(m.totals.extraPayment).toBe(0);
    const withExtra = buildLiabilityAmortizationData(
      { liabilities: [loan({ extraPayments: [{ id: "e", liabilityId: "loan", year: 2027, type: "lump_sum", amount: 10_000 }] })] } as unknown as ClientData,
      { liabilityIds: null },
      "Base Case",
      TODAY,
    );
    expect(withExtra.loans[0].totals.extraPayment).toBe(10_000);
  });

  it("explains a forgiven balance and names the year", () => {
    const forgiven = buildLiabilityAmortizationData(
      { liabilities: [loan({ balance: 60_000, interestRate: 0.068, monthlyPayment: 380, termMonths: 240, forgiveAtTermEnd: true })] } as unknown as ClientData,
      { liabilityIds: null },
      "Base Case",
      TODAY,
    ).loans[0];
    expect(forgiven.facts.at(-1)).toEqual({ label: "Forgiven", value: "2041" });
    expect(forgiven.footnote).toMatch(/^\$[\d,]+ forgiven in 2041/);
  });

  it("counts one sheet per schedule sheet and names each loan in the Contents", () => {
    expect(estimateLiabilityAmortizationPageCount(data)).toBe(m.sheets.length + data.loans[1].sheets.length);
    expect(liabilityAmortizationTocSections(data)).toEqual([
      { title: "Amortization — Mortgage", offset: 0 },
      { title: "Amortization — Car loan", offset: m.sheets.length },
    ]);
  });

  it("keeps one sheet for the empty state", () => {
    const empty = buildLiabilityAmortizationData(plan, { liabilityIds: ["card"] }, "Base Case", TODAY);
    expect(empty.loans).toEqual([]);
    expect(estimateLiabilityAmortizationPageCount(empty)).toBe(1);
    expect(liabilityAmortizationTocSections(empty)).toEqual([{ title: "Loan Amortization", offset: 0 }]);
  });
});

describe("paginateRows", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("keeps a short schedule and its totals on one sheet", () => {
    expect(paginateRows(rows(FIRST_SHEET_ROWS - 1), 1)).toEqual([rows(FIRST_SHEET_ROWS - 1)]);
  });

  it("carries rows over rather than printing the totals alone", () => {
    const sheets = paginateRows(rows(FIRST_SHEET_ROWS), 1);
    expect(sheets.map((s) => s.length)).toEqual([FIRST_SHEET_ROWS - 1, 1]);
  });

  it("fills continuation sheets to their own capacity", () => {
    const n = FIRST_SHEET_ROWS + NEXT_SHEET_ROWS + 5;
    expect(paginateRows(rows(n), 3).map((s) => s.length)).toEqual([FIRST_SHEET_ROWS, NEXT_SHEET_ROWS, 5]);
  });
});

describe("options", () => {
  it("summarizes the pick", () => {
    expect(summarizeLiabilityAmortizationOptions({ liabilityIds: null })).toBe("All loans");
    expect(summarizeLiabilityAmortizationOptions({ liabilityIds: ["a"] })).toBe("1 loan");
    expect(summarizeLiabilityAmortizationOptions({ liabilityIds: ["a", "b"] })).toBe("2 loans");
  });

  it("blocks export only on an explicit pick of nothing", () => {
    expect(isLiabilityAmortizationUnconfigured({ liabilityIds: [] })).toBe(true);
    expect(isLiabilityAmortizationUnconfigured({ liabilityIds: null })).toBe(false);
    expect(isLiabilityAmortizationUnconfigured({ liabilityIds: ["a"] })).toBe(false);
  });

  it("accepts all-loans and a list, and rejects anything else", () => {
    expect(liabilityAmortizationOptionsSchema.safeParse({ liabilityIds: null }).success).toBe(true);
    expect(liabilityAmortizationOptionsSchema.safeParse({ liabilityIds: ["a"] }).success).toBe(true);
    expect(liabilityAmortizationOptionsSchema.safeParse({}).success).toBe(false);
  });
});
