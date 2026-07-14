// mobile/src/recurrings/form.test.ts
//
// Pure-fn tests for the recurring create/edit form state. Validation mirrors
// the API (src/app/api/portal/recurrings/route.ts:41-128): non-empty name +
// pattern; finite amounts with max >= min; monthly -> dueDay null (anytime)
// or 1-31; annually -> dueMonth 1-12; category required.
import { describe, it, expect } from "vitest";
import { emptyForm, fromRow, validate, toUpsertBody, toPreviewQuery, type RecurringFormState } from "./form";
import type { RecurringRowDTO } from "@contracts";

const baseRow = (over: Partial<RecurringRowDTO> = {}): RecurringRowDTO => ({
  id: "r1",
  name: "Netflix",
  cadence: "monthly",
  dueDay: null,
  dueMonth: null,
  matchType: "contains",
  pattern: "Netflix",
  amountMin: 10,
  amountMax: 20,
  categoryId: "c1",
  categoryName: "Subscriptions",
  categoryColor: "var(--data-purple)",
  categoryIcon: "📺",
  predicted: 15,
  state: "due",
  postedThisMonth: 0,
  nextPaymentDate: null,
  timeline: [],
  metricsByYear: [],
  ...over,
});

const validForm = (over: Partial<RecurringFormState> = {}): RecurringFormState => ({
  ...emptyForm(),
  name: "Netflix",
  pattern: "Netflix",
  amountMin: "10",
  amountMax: "20",
  categoryId: "c1",
  ...over,
});

describe("emptyForm", () => {
  it("defaults to a monthly/anytime/contains shape with no category", () => {
    const f = emptyForm();
    expect(f.matchType).toBe("contains");
    expect(f.cadence).toBe("monthly");
    expect(f.anytime).toBe(true);
    expect(f.categoryId).toBeNull();
    expect(f.name).toBe("");
    expect(f.pattern).toBe("");
    expect(f.amountMin).toBe("");
    expect(f.amountMax).toBe("");
    expect(f.dueDay).toBe("");
    expect(f.dueMonth).toBe("");
  });
});

describe("toUpsertBody", () => {
  it("happy monthly-anytime body has dueDay: null, dueMonth: null", () => {
    const f = validForm({ cadence: "monthly", anytime: true });
    expect(toUpsertBody(f)).toEqual({
      name: "Netflix",
      matchType: "contains",
      pattern: "Netflix",
      amountMin: 10,
      amountMax: 20,
      cadence: "monthly",
      dueDay: null,
      dueMonth: null,
      categoryId: "c1",
    });
  });

  it("monthly with a specific due day carries it through, dueMonth still null", () => {
    const f = validForm({ cadence: "monthly", anytime: false, dueDay: "31" });
    const body = toUpsertBody(f);
    expect(body.dueDay).toBe(31);
    expect(body.dueMonth).toBeNull();
  });

  it("annually carries dueMonth through, dueDay always null", () => {
    const f = validForm({ cadence: "annually", dueMonth: "6" });
    const body = toUpsertBody(f);
    expect(body.dueMonth).toBe(6);
    expect(body.dueDay).toBeNull();
  });

  it("trims name and pattern, coerces amounts to numbers", () => {
    const f = validForm({ name: "  Netflix  ", pattern: "  Netflix  ", amountMin: "10.5", amountMax: "20.75" });
    const body = toUpsertBody(f);
    expect(body.name).toBe("Netflix");
    expect(body.pattern).toBe("Netflix");
    expect(body.amountMin).toBe(10.5);
    expect(body.amountMax).toBe(20.75);
  });
});

describe("validate", () => {
  it("accepts a happy monthly-anytime form", () => {
    expect(validate(validForm({ cadence: "monthly", anytime: true }))).toBeNull();
  });

  it("rejects an empty name", () => {
    expect(validate(validForm({ name: "" }))).not.toBeNull();
    expect(validate(validForm({ name: "   " }))).not.toBeNull();
  });

  it("rejects an empty pattern", () => {
    expect(validate(validForm({ pattern: "" }))).not.toBeNull();
    expect(validate(validForm({ pattern: "   " }))).not.toBeNull();
  });

  it("rejects non-finite amounts", () => {
    expect(validate(validForm({ amountMin: "abc" }))).not.toBeNull();
    expect(validate(validForm({ amountMax: "" }))).not.toBeNull();
  });

  it("rejects max < min", () => {
    expect(validate(validForm({ amountMin: "20", amountMax: "10" }))).not.toBeNull();
  });

  it("accepts max === min", () => {
    expect(validate(validForm({ amountMin: "10", amountMax: "10" }))).toBeNull();
  });

  it("monthly day 31 ok, 32 rejected", () => {
    expect(validate(validForm({ cadence: "monthly", anytime: false, dueDay: "31" }))).toBeNull();
    expect(validate(validForm({ cadence: "monthly", anytime: false, dueDay: "32" }))).not.toBeNull();
  });

  it("monthly day 0 rejected (must be 1-31)", () => {
    expect(validate(validForm({ cadence: "monthly", anytime: false, dueDay: "0" }))).not.toBeNull();
  });

  it("monthly anytime skips due-day validation entirely", () => {
    expect(validate(validForm({ cadence: "monthly", anytime: true, dueDay: "" }))).toBeNull();
    expect(validate(validForm({ cadence: "monthly", anytime: true, dueDay: "99" }))).toBeNull();
  });

  it("annually month 0/13 rejected", () => {
    expect(validate(validForm({ cadence: "annually", dueMonth: "0" }))).not.toBeNull();
    expect(validate(validForm({ cadence: "annually", dueMonth: "13" }))).not.toBeNull();
  });

  it("annually month 1 and 12 (boundaries) accepted", () => {
    expect(validate(validForm({ cadence: "annually", dueMonth: "1" }))).toBeNull();
    expect(validate(validForm({ cadence: "annually", dueMonth: "12" }))).toBeNull();
  });

  it("rejects a missing category", () => {
    expect(validate(validForm({ categoryId: null }))).not.toBeNull();
  });
});

describe("toPreviewQuery", () => {
  it("null while pattern is empty", () => {
    expect(toPreviewQuery(validForm({ pattern: "" }))).toBeNull();
    expect(toPreviewQuery(validForm({ pattern: "   " }))).toBeNull();
  });

  it("null until both amounts parse", () => {
    expect(toPreviewQuery(validForm({ amountMin: "" }))).toBeNull();
    expect(toPreviewQuery(validForm({ amountMax: "abc" }))).toBeNull();
  });

  it("non-null once pattern is set and both amounts parse, regardless of name/category", () => {
    const f = validForm({ name: "", categoryId: null, pattern: "Netflix", amountMin: "10", amountMax: "20" });
    expect(toPreviewQuery(f)).toEqual({
      matchType: "contains",
      pattern: "Netflix",
      amountMin: 10,
      amountMax: 20,
    });
  });
});

describe("fromRow", () => {
  it("round-trips a monthly row (with a specific due day) into an equal upsert body", () => {
    const row = baseRow({
      name: "Netflix", matchType: "exact", pattern: "Netflix", amountMin: 10, amountMax: 20,
      cadence: "monthly", dueDay: 15, dueMonth: null, categoryId: "c1",
    });
    const f = fromRow(row);
    expect(f.anytime).toBe(false);
    expect(validate(f)).toBeNull();
    expect(toUpsertBody(f)).toEqual({
      name: row.name, matchType: row.matchType, pattern: row.pattern,
      amountMin: row.amountMin, amountMax: row.amountMax, cadence: row.cadence,
      dueDay: row.dueDay, dueMonth: row.dueMonth, categoryId: row.categoryId,
    });
  });

  it("round-trips a monthly-anytime row (dueDay null) into an equal upsert body", () => {
    const row = baseRow({ cadence: "monthly", dueDay: null, dueMonth: null });
    const f = fromRow(row);
    expect(f.anytime).toBe(true);
    expect(validate(f)).toBeNull();
    expect(toUpsertBody(f)).toEqual({
      name: row.name, matchType: row.matchType, pattern: row.pattern,
      amountMin: row.amountMin, amountMax: row.amountMax, cadence: row.cadence,
      dueDay: row.dueDay, dueMonth: row.dueMonth, categoryId: row.categoryId,
    });
  });

  it("round-trips an annual row into an equal upsert body", () => {
    const row = baseRow({
      name: "Copilot", matchType: "exact", pattern: "Copilot", amountMin: 95, amountMax: 110,
      cadence: "annually", dueDay: null, dueMonth: 6, categoryId: "c2",
    });
    const f = fromRow(row);
    expect(validate(f)).toBeNull();
    expect(toUpsertBody(f)).toEqual({
      name: row.name, matchType: row.matchType, pattern: row.pattern,
      amountMin: row.amountMin, amountMax: row.amountMax, cadence: row.cadence,
      dueDay: row.dueDay, dueMonth: row.dueMonth, categoryId: row.categoryId,
    });
  });

  it("round-trips an annual row with no dueMonth set", () => {
    const row = baseRow({ cadence: "annually", dueDay: null, dueMonth: null });
    const f = fromRow(row);
    expect(f.dueMonth).toBe("");
    // Not directly validate()-able (annual requires a 1-12 dueMonth), but the
    // seeded field itself must round-trip the row's null.
    expect(toUpsertBody({ ...f, dueMonth: "1" }).dueMonth).toBe(1);
  });
});
