/**
 * `noteReceivableUpdateSchema` must be PARTIAL — absent keys must stay absent.
 *
 * The PATCH route guards each write with `input.X !== undefined`, and an
 * injected key is not undefined — so `startMonth: 1` would be written on every
 * partial patch, silently resetting a note that amortises from, say, July.
 *
 * `extraPayments: []` is also injected. The route happens to ignore that key
 * today (extra payments are replaced through
 * `noteReceivableExtraPaymentsReplaceSchema` on their own endpoint), so it is
 * inert — but it is one `if (i.extraPayments !== undefined)` away from
 * truncating the table, which is exactly how the insurance cash-value schedule
 * got wiped.
 */
import { describe, it, expect } from "vitest";
import {
  noteReceivableCreateSchema,
  noteReceivableUpdateSchema,
} from "../note-receivable";

describe("noteReceivableUpdateSchema is partial", () => {
  it("parses a one-key body to exactly that one key", () => {
    const result = noteReceivableUpdateSchema.safeParse({ name: "Seller note" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data)).toHaveLength(1);
    expect(result.data).toEqual({ name: "Seller note" });
  });

  it("does not inject startMonth or extraPayments", () => {
    const result = noteReceivableUpdateSchema.safeParse({ interestRate: 0.055 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // startMonth: 1 is WRITTEN by the route's guard; extraPayments: [] is the
    // shape that truncates an array table the moment a guard is added for it.
    expect(result.data).not.toHaveProperty("startMonth");
    expect(result.data).not.toHaveProperty("extraPayments");
  });

  it("parses an empty body to an empty object", () => {
    const result = noteReceivableUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("still round-trips an explicit startMonth", () => {
    const result = noteReceivableUpdateSchema.safeParse({ startMonth: 7 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ startMonth: 7 });
  });

  it("still validates the fields that ARE sent", () => {
    expect(noteReceivableUpdateSchema.safeParse({ startMonth: 13 }).success).toBe(false);
    expect(noteReceivableUpdateSchema.safeParse({ faceValue: -1 }).success).toBe(false);
    expect(noteReceivableUpdateSchema.safeParse({ owners: [] }).success).toBe(false);
  });

  it("still accepts null on a nullable field", () => {
    const result = noteReceivableUpdateSchema.safeParse({ asOfBalance: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ asOfBalance: null });
  });
});

describe("noteReceivableCreateSchema keeps its defaults", () => {
  it("still defaults startMonth and extraPayments on create", () => {
    const result = noteReceivableCreateSchema.safeParse({
      name: "Seller note",
      faceValue: 500_000,
      basis: 500_000,
      interestRate: 0.05,
      paymentType: "amortizing",
      startYear: 2026,
      termMonths: 120,
      owners: [
        { familyMemberId: "11111111-1111-1111-1111-111111111111", percent: 1 },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.startMonth).toBe(1);
    expect(result.data.extraPayments).toEqual([]);
  });
});
