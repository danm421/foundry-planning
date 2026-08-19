import { describe, it, expect } from "vitest";
import {
  DEFAULT_DEBT_PAYDOWN_STATE,
  MAX_MANUAL_DEBTS,
  validateDebtPaydownState,
} from "@/lib/calculators/debt-paydown-state";

const VALID = {
  v: 1,
  strategy: "snowball",
  mode: "target",
  extraMonthly: 250,
  targetMonth: "2032-03",
  excludedDebtIds: ["liab-1"],
  overrides: { "liab-2": { annualRate: 0.0649, minimumPayment: 350 } },
  manualDebts: [
    { id: "m1", name: "Visa", balance: 4200, annualRate: 0.2199, minimumPayment: 120 },
  ],
};

describe("validateDebtPaydownState — the happy path", () => {
  it("round-trips a valid payload unchanged", () => {
    const res = validateDebtPaydownState(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toEqual(VALID);
  });

  it("fills the defaults for a bare payload", () => {
    const res = validateDebtPaydownState({ strategy: "avalanche" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toEqual(DEFAULT_DEBT_PAYDOWN_STATE);
  });
});

describe("validateDebtPaydownState — what it refuses", () => {
  // The point of the validator: nothing from the body reaches the jsonb column
  // except a field this function rebuilt itself.
  it("drops keys it does not know about", () => {
    const res = validateDebtPaydownState({ ...VALID, clientId: "someone-else", isAdmin: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state).not.toHaveProperty("clientId");
      expect(res.state).not.toHaveProperty("isAdmin");
    }
  });

  it.each([
    ["a non-object", "nope"],
    ["an array", []],
    ["an unknown strategy", { ...VALID, strategy: "fastest" }],
    ["a rate above 100%", { ...VALID, manualDebts: [{ ...VALID.manualDebts[0], annualRate: 1.5 }] }],
    ["a percent where a fraction belongs", { ...VALID, overrides: { x: { annualRate: 6.49 } } }],
    ["a malformed target month", { ...VALID, targetMonth: "March 2032" }],
    ["a month 13", { ...VALID, targetMonth: "2032-13" }],
    ["manualDebts that is not a list", { ...VALID, manualDebts: { id: "m1" } }],
    ["a nameless added debt", { ...VALID, manualDebts: [{ ...VALID.manualDebts[0], name: "  " }] }],
    ["a negative balance", { ...VALID, manualDebts: [{ ...VALID.manualDebts[0], balance: -1 }] }],
  ])("refuses %s", (_label, payload) => {
    expect(validateDebtPaydownState(payload).ok).toBe(false);
  });

  it("caps how many debts a client can add by hand", () => {
    const many = Array.from({ length: MAX_MANUAL_DEBTS + 1 }, (_, i) => ({
      id: `m${i}`, name: `Debt ${i}`, balance: 100, annualRate: 0.1, minimumPayment: 10,
    }));
    const res = validateDebtPaydownState({ ...VALID, manualDebts: many });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(String(MAX_MANUAL_DEBTS));
  });

  it("caps the overall payload size", () => {
    const fat = Array.from({ length: MAX_MANUAL_DEBTS }, (_, i) => ({
      id: `m${i}`, name: "x".repeat(60), balance: 100, annualRate: 0.1, minimumPayment: 10,
    }));
    const res = validateDebtPaydownState({
      ...VALID,
      manualDebts: fat,
      // Correction 1 (task-3-report.md): the brief's original fixture used
      // "y".repeat(64) + i, giving 65-67 char ids that validId() (which caps
      // ids at MAX_ID_LENGTH = 64) refuses before the size check ever runs —
      // proving nothing about MAX_STATE_BYTES. 61 repeats + a 1-3 digit index
      // keeps every id at 62-64 chars (within MAX_ID_LENGTH) while still
      // producing exactly 200 entries (at, not over, MAX_ID_ENTRIES).
      // Measured with JSON.stringify: 16,820 bytes against the 16,384 cap.
      excludedDebtIds: Array.from({ length: 200 }, (_, i) => "y".repeat(61) + i),
    });
    expect(res.ok).toBe(false);
    // Correction 2: assert WHICH refusal fired, not just that one did — an id
    // refusal would also make res.ok false and prove nothing about the size
    // ceiling.
    if (!res.ok) expect(res.error).toContain("more than this calculator can save");
  });
});
