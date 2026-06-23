import { describe, it, expect } from "vitest";
import { fmtAmount, formatDayHeader, badgeFor } from "@/components/portal/transaction-format";

describe("fmtAmount", () => {
  it("money in (negative Plaid amount) → +$ in good color", () => {
    expect(fmtAmount("-1000")).toEqual({ text: "+$1,000.00", cls: "text-good" });
  });
  it("money out (positive Plaid amount) → -$ in neutral color", () => {
    expect(fmtAmount("17.06")).toEqual({ text: "-$17.06", cls: "text-ink" });
  });
  it("zero → plain neutral", () => {
    expect(fmtAmount("0")).toEqual({ text: "$0.00", cls: "text-ink" });
  });
});

describe("formatDayHeader", () => {
  it("formats an ISO date as an uppercase weekday header (UTC, no drift)", () => {
    expect(formatDayHeader("2026-05-30")).toBe("SAT, MAY 30");
  });
});

describe("badgeFor", () => {
  it("transfer → T, income → I, recurring expense → R, plain expense → null", () => {
    expect(badgeFor("transfer", false)).toBe("T");
    expect(badgeFor("income", false)).toBe("I");
    expect(badgeFor("expense", true)).toBe("R");
    expect(badgeFor("expense", false)).toBeNull();
  });
  it("type wins over recurring for the badge letter", () => {
    expect(badgeFor("transfer", true)).toBe("T");
    expect(badgeFor("income", true)).toBe("I");
  });
});
