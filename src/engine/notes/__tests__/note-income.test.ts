import { describe, it, expect } from "vitest";
import { noteIncomeForYear, noteBalanceAtYear } from "../note-income";
import type { Account } from "@/engine/types";

const note: Account = {
  id: "n1",
  name: "Note from buyer X",
  category: "taxable",
  subType: "promissory_note",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  titlingType: "jtwros",
  owners: [],
  noteInterestRate: 0.05,
  noteTermMonths: 120,
  noteStartYear: 2026,
  notePaymentType: "amortizing",
};

describe("note-income", () => {
  it("emits interest + principal in the start year", () => {
    const row = noteIncomeForYear(note, 2026);
    expect(row).not.toBeNull();
    expect(row!.interest).toBeGreaterThan(0);
    expect(row!.principal).toBeGreaterThan(0);
  });

  it("returns null before noteStartYear and after term", () => {
    expect(noteIncomeForYear(note, 2025)).toBeNull();
    expect(noteIncomeForYear(note, 2036)).toBeNull();
  });

  it("computes outstanding balance at a year mid-term", () => {
    const balance5 = noteBalanceAtYear(note, 2030);
    expect(balance5).toBeLessThan(100_000);
    expect(balance5).toBeGreaterThan(0);
  });
});
