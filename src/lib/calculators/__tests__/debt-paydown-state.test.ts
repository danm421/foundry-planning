import { describe, it, expect } from "vitest";
import {
  DEFAULT_DEBT_PAYDOWN_STATE,
  MAX_MANUAL_DEBTS,
  createDefaultDebtPaydownState,
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

  // Fix round 1, Finding 1: the top-level rebuild was covered, but the two
  // NESTED rebuilds (an override, a manual debt) were not. A mutant that
  // spreads the caller's object into `out` or into the pushed ManualDebt
  // still passes every validation check and every pre-existing test — see
  // the mutation-proof record in task-3-report.md's "Fix round 1" section.
  it("drops keys from a nested override it does not know about", () => {
    const res = validateDebtPaydownState({
      ...VALID,
      overrides: { "liab-2": { annualRate: 0.05, isAdmin: true } },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.overrides["liab-2"]).not.toHaveProperty("isAdmin");
      expect(res.state.overrides["liab-2"]).toEqual({ annualRate: 0.05 });
    }
  });

  it("drops keys from a nested manual debt it does not know about", () => {
    const res = validateDebtPaydownState({
      ...VALID,
      manualDebts: [{ ...VALID.manualDebts[0], householdId: "someone-elses-household" }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.manualDebts[0]).not.toHaveProperty("householdId");
      expect(res.state.manualDebts[0]).toEqual(VALID.manualDebts[0]);
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

  // Fix round 1, Finding 3: two manual debts sharing an id would later merge
  // with real liabilities into one id-keyed collection, where a duplicate
  // silently loses a debt. Uniqueness within the payload is checkable here
  // (a collision with a real liability id is not — see the ManualDebt.id
  // doc comment) so it is enforced here.
  it("refuses two added debts sharing an id", () => {
    const res = validateDebtPaydownState({
      ...VALID,
      manualDebts: [VALID.manualDebts[0], { ...VALID.manualDebts[0], name: "Second Card" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Give each added debt its own id.");
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

// Fix round 1, Finding 2: DEFAULT_DEBT_PAYDOWN_STATE's arrays/objects were
// live references on a module-level constant. A consumer doing
// `saved ?? DEFAULT_DEBT_PAYDOWN_STATE` and then mutating the result (e.g.
// pushing a manual debt) would corrupt the shared default for the lifetime
// of the server process, leaking one client's data into the next client's
// "empty" starting point.
describe("createDefaultDebtPaydownState / DEFAULT_DEBT_PAYDOWN_STATE — no shared mutable state", () => {
  it("gives every caller of createDefaultDebtPaydownState() a fresh, independently mutable object", () => {
    const a = createDefaultDebtPaydownState();
    const b = createDefaultDebtPaydownState();
    a.manualDebts.push({ id: "m1", name: "Card", balance: 100, annualRate: 0.1, minimumPayment: 10 });
    a.excludedDebtIds.push("liab-9");
    a.overrides["liab-9"] = { annualRate: 0.1 };
    expect(a).not.toBe(b);
    expect(b.manualDebts).toEqual([]);
    expect(b.excludedDebtIds).toEqual([]);
    expect(b.overrides).toEqual({});
  });

  it("freezes DEFAULT_DEBT_PAYDOWN_STATE so a consumer cannot corrupt the shared default", () => {
    expect(() => {
      DEFAULT_DEBT_PAYDOWN_STATE.manualDebts.push({
        id: "m1", name: "Card", balance: 100, annualRate: 0.1, minimumPayment: 10,
      });
    }).toThrow();
    expect(() => {
      DEFAULT_DEBT_PAYDOWN_STATE.overrides["liab-9"] = { annualRate: 0.1 };
    }).toThrow();
    expect(DEFAULT_DEBT_PAYDOWN_STATE.manualDebts).toEqual([]);
    expect(DEFAULT_DEBT_PAYDOWN_STATE.overrides).toEqual({});
  });
});
