// src/lib/fact-finder/__tests__/normalize.test.ts
import { describe, expect, it } from "vitest";
import {
  FILING,
  INSURED,
  MONTHS,
  OWNER,
  RETIRE_TYPE,
  STATES,
  TRUST_GRANTOR,
  YES_NO,
  type ColumnKind,
  type FFColumn,
} from "../schema";
import { expandTwoDigitYear, normalizeCell, parseDate, parseMonthYear } from "../normalize";

const col = (kind: ColumnKind, options?: readonly string[]): FFColumn =>
  ({ id: "x", label: "Value", kind, ...(options ? { options } : {}) }) as FFColumn;
const ok = (value: unknown) => ({ ok: true, value });

describe("normalizeCell", () => {
  it.each([
    ["$1,234.56", 1234.56],
    ["1.2M", 1_200_000],
    ["$1.2m", 1_200_000],
    ["250k", 250_000],
    ["(1,234)", -1234],
    ["-$500", -500],
    ["USD 900", 900],
    [1500, 1500],
  ])("money %s", (raw, want) => {
    expect(normalizeCell(col("money"), raw)).toEqual(ok(want));
  });

  it("keeps money it can't read as text, flagged", () => {
    expect(normalizeCell(col("money"), "about $5k")).toEqual({ ok: false, issue: "unparsed", text: "about $5k" });
  });

  it.each([
    ["6.5%", 6.5],
    ["6.5", 6.5],
    [" 3 % ", 3],
    [0.065, 0.065],
  ])("percent %s stays a whole-number percent", (raw, want) => {
    expect(normalizeCell(col("percent"), raw)).toEqual(ok(want));
  });

  it.each([
    ["2041-08-01", "2041-08-01"],
    ["8/1/2041", "2041-08-01"],
    ["08-01-2041", "2041-08-01"],
    ["Aug 1, 2041", "2041-08-01"],
    ["August 1st, 2041", "2041-08-01"],
    ["1 Aug 2041", "2041-08-01"],
    ["2041-08-01T00:00:00Z", "2041-08-01"],
    ["7/4/62", "1962-07-04"],
    ["3/1/27", "2027-03-01"],
  ])("date %s", (raw, want) => {
    expect(normalizeCell(col("date"), raw)).toEqual(ok(want));
  });

  it.each(["2/30/2041", "Age 28 (Aug 2026)", "soon"])("flags date %s", (raw) => {
    expect(normalizeCell(col("date"), raw)).toEqual({ ok: false, issue: "unparsed", text: raw });
  });

  it.each([
    ["2027-08", "2027-08"],
    ["08/2027", "2027-08"],
    ["8/27", "2027-08"],
    ["Aug 2027", "2027-08"],
    ["August, 2027", "2027-08"],
    ["8/15/2027", "2027-08"],
    ["2027-08-15", "2027-08"],
  ])("month/year %s", (raw, want) => {
    expect(normalizeCell(col("monthYear"), raw)).toEqual(ok(want));
  });

  it("reads years and whole numbers strictly", () => {
    expect(normalizeCell(col("year"), "2027")).toEqual(ok(2027));
    expect(normalizeCell(col("year"), 2027)).toEqual(ok(2027));
    expect(normalizeCell(col("year"), "27").ok).toBe(false);
    expect(normalizeCell(col("year"), "1850").ok).toBe(false);
    expect(normalizeCell(col("integer"), "65")).toEqual(ok(65));
    expect(normalizeCell(col("integer"), "65.0")).toEqual(ok(65));
    expect(normalizeCell(col("integer"), "65.5").ok).toBe(false);
    expect(normalizeCell(col("number"), "1,300")).toEqual(ok(1300));
  });

  it.each([
    [OWNER, "Co-client", "Co-client"],
    [OWNER, "spouse", "Co-client"],
    [OWNER, "JOINT", "Joint"],
    [RETIRE_TYPE, "401k", "401(k)"],
    [RETIRE_TYPE, "Roth", "Roth IRA"],
    [RETIRE_TYPE, "ira", "Traditional IRA"],
    [RETIRE_TYPE, "sep", "SEP IRA"],
    [FILING, "MFJ", "Married filing jointly"],
    [STATES, "Colorado", "CO"],
    [STATES, "co", "CO"],
    [MONTHS, "Aug", "August"],
    [MONTHS, "8", "August"],
    [YES_NO, "y", "Yes"],
    [INSURED, "joint", "Joint (survivorship)"],
  ])("choice %#: %s", (options, raw, want) => {
    expect(normalizeCell(col("choice", options), raw)).toEqual(ok(want));
  });

  it("keeps an off-list choice as text, flagged — never dropped", () => {
    expect(normalizeCell(col("choice", TRUST_GRANTOR), "Joint")).toEqual({
      ok: false,
      issue: "notAnOption",
      text: "Joint",
    });
  });

  it("reads checks, treating the PDF's 'Off' as blank", () => {
    expect(normalizeCell(col("check"), "Yes")).toEqual(ok(true));
    expect(normalizeCell(col("check"), "X")).toEqual(ok(true));
    expect(normalizeCell(col("check"), true)).toEqual(ok(true));
    expect(normalizeCell(col("check"), "No")).toEqual(ok(false));
    expect(normalizeCell(col("check"), "Off")).toEqual(ok(null));
    expect(normalizeCell(col("check"), "maybe").ok).toBe(false);
  });

  it("treats blanks as empty and trims text", () => {
    for (const raw of ["", "   ", null, undefined]) expect(normalizeCell(col("money"), raw)).toEqual(ok(null));
    expect(normalizeCell(col("text"), "  Fidelity  ")).toEqual(ok("Fidelity"));
  });
});

describe("expandTwoDigitYear", () => {
  it("puts years more than ten years out in the last century", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    expect(expandTwoDigitYear(36, now)).toBe(2036);
    expect(expandTwoDigitYear(37, now)).toBe(1937);
  });
});

describe("two-digit years with a fixed now", () => {
  const now = new Date("2026-10-12T00:00:00Z");

  it("reads a two-digit date year as a birth date, not a far-future date", () => {
    // date columns are past dates or near-term expiries, so the now+10 pivot applies
    expect(parseDate("8/1/41", now)).toBe("1941-08-01");
  });

  it("looks 35 years ahead for month/year, so a 30-year loan maturity reads right", () => {
    expect(parseMonthYear("8/51", now)).toBe("2051-08");
    expect(parseMonthYear("8/61", now)).toBe("2061-08");
    expect(parseMonthYear("8/62", now)).toBe("1962-08");
    expect(parseMonthYear("8/95", now)).toBe("1995-08");
    expect(expandTwoDigitYear(61, now, 35)).toBe(2061);
    expect(expandTwoDigitYear(62, now, 35)).toBe(1962);
  });
});
