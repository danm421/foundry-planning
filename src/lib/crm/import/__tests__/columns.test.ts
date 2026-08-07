import { describe, it, expect } from "vitest";
import {
  TEMPLATE_HEADERS,
  detectMapping,
  sanitizeMapping,
  normalizeHeader,
} from "../columns";

describe("TEMPLATE_HEADERS", () => {
  it("is the 16-column template with advisor_id removed", () => {
    expect(TEMPLATE_HEADERS).toEqual([
      "household_name", "primary_first", "primary_last", "primary_email",
      "primary_phone", "primary_dob", "spouse_first", "spouse_last",
      "spouse_email", "spouse_dob", "status", "notes",
      "address_line1", "city", "state", "postal_code",
    ]);
    expect(TEMPLATE_HEADERS).not.toContain("advisor_id");
  });
});

describe("normalizeHeader", () => {
  it("lowercases and collapses punctuation to single spaces", () => {
    expect(normalizeHeader("  Primary_First-Name ")).toBe("primary first name");
  });
});

describe("detectMapping", () => {
  it("maps the canonical template one-to-one", () => {
    const m = detectMapping([...TEMPLATE_HEADERS]);
    expect(m.householdName).toBe(0);
    expect(m.primaryFirst).toBe(1);
    expect(m.postalCode).toBe(15);
  });

  it("is order-independent and case-insensitive", () => {
    const m = detectMapping(["Last Name", "FIRST NAME", "Household"]);
    expect(m.primaryLast).toBe(0);
    expect(m.primaryFirst).toBe(1);
    expect(m.householdName).toBe(2);
  });

  it("resolves human aliases", () => {
    const m = detectMapping(["Surname", "Given Name", "Date of Birth", "Zip"]);
    expect(m.primaryLast).toBe(0);
    expect(m.primaryFirst).toBe(1);
    expect(m.primaryDob).toBe(2);
    expect(m.postalCode).toBe(3);
  });

  it("ignores advisor_id and any other unknown column", () => {
    const m = detectMapping(["primary_first", "advisor_id", "crm_internal_ref"]);
    expect(m.primaryFirst).toBe(0);
    expect(Object.values(m)).toEqual([0]);
  });

  it("never maps two fields to the same column", () => {
    const m = detectMapping(["name", "name"]);
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it("returns an empty mapping for a header row it cannot read", () => {
    expect(detectMapping(["col1", "col2"])).toEqual({});
  });
});

describe("sanitizeMapping", () => {
  it("drops unknown fields and out-of-range indices", () => {
    const m = sanitizeMapping(
      { primaryFirst: 0, bogusField: 1, primaryLast: 99, spouseFirst: -1 },
      3,
    );
    expect(m).toEqual({ primaryFirst: 0 });
  });

  it("returns an empty mapping for a non-object", () => {
    expect(sanitizeMapping("nope", 3)).toEqual({});
  });
});
