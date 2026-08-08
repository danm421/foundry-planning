import { describe, it, expect } from "vitest";
import { createCrmContactSchema } from "@/lib/crm/schemas";
import {
  parseImportDate,
  parseStatus,
  parseState,
  parseEmail,
  clampText,
} from "../coerce";

describe("parseImportDate", () => {
  it("passes through an ISO date", () => {
    expect(parseImportDate("1980-01-01")).toBe("1980-01-01");
  });

  it("reads a typed US date month-first", () => {
    expect(parseImportDate("1/15/1970")).toBe("1970-01-15");
    expect(parseImportDate("12/25/1985")).toBe("1985-12-25");
    expect(parseImportDate("3-4-1990")).toBe("1990-03-04");
  });

  it("converts an Excel serial", () => {
    // 25569 is the Excel serial for the Unix epoch.
    expect(parseImportDate(25569)).toBe("1970-01-01");
    expect(parseImportDate(29221)).toBe("1980-01-01");
    expect(parseImportDate("29221")).toBe("1980-01-01");
  });

  it("handles the pre-1900-03-01 serial offset", () => {
    expect(parseImportDate(59)).toBe("1900-02-28");
  });

  it("rejects serial 60 — Excel's phantom 1900-02-29", () => {
    expect(parseImportDate(60)).toBeNull();
  });

  it("rejects serials outside 1900-2100", () => {
    expect(parseImportDate(1)).toBeNull();
    expect(parseImportDate(999999)).toBeNull();
  });

  it("rejects a two-digit year as ambiguous", () => {
    expect(parseImportDate("1/15/70")).toBeNull();
  });

  it("rejects an impossible calendar date", () => {
    expect(parseImportDate("2/30/1980")).toBeNull();
    expect(parseImportDate("13/1/1980")).toBeNull();
    expect(parseImportDate("1980-02-30")).toBeNull();
  });

  it("returns null for blank and for junk", () => {
    expect(parseImportDate("")).toBeNull();
    expect(parseImportDate("   ")).toBeNull();
    expect(parseImportDate("sometime in 1980")).toBeNull();
  });
});

describe("parseStatus", () => {
  it("defaults blank to prospect and reports it as recognized", () => {
    expect(parseStatus("")).toEqual({ value: "prospect", recognized: true });
  });

  it("accepts any casing", () => {
    expect(parseStatus("  Active ")).toEqual({ value: "active", recognized: true });
  });

  it("falls back to prospect and flags an unrecognized value", () => {
    expect(parseStatus("VIP")).toEqual({ value: "prospect", recognized: false });
  });
});

describe("parseState", () => {
  it("accepts a USPS code in any casing", () => {
    expect(parseState("il")).toBe("IL");
  });

  it("accepts a full state name", () => {
    expect(parseState("Illinois")).toBe("IL");
    expect(parseState("district of columbia")).toBe("DC");
  });

  it("returns null for blank or unknown", () => {
    expect(parseState("")).toBeNull();
    expect(parseState("Ontario")).toBeNull();
  });
});

describe("parseEmail", () => {
  it("lowercases and trims a valid address", () => {
    expect(parseEmail("  Jane@Example.COM ")).toBe("jane@example.com");
  });

  it("returns null for blank or invalid", () => {
    expect(parseEmail("")).toBeNull();
    expect(parseEmail("not-an-email")).toBeNull();
  });

  // parseEmail must refuse EXACTLY what createCrmContactSchema.email refuses.
  // The commit route validates the batch atomically, so an address parseEmail
  // lets through and Zod then rejects costs the WHOLE import — a 400 with zero
  // rows created and nothing on screen naming the cell. Every address below is
  // one the old hand-rolled /^[^\s@]+@[^\s@]+\.[^\s@]+$/ accepted and z.email()
  // rejects; each must now be a null (i.e. a per-row warning) instead.
  it.each([
    ["josé@example.com", "non-ASCII local part"],
    ["a..b@x.com", "consecutive dots"],
    ["jane@example.com.", "trailing dot"],
    [".jane@example.com", "leading dot"],
    ["a@b.c", "single-character TLD"],
  ])("rejects %s (%s) rather than deferring to the commit schema", (address) => {
    expect(parseEmail(address)).toBeNull();
    expect(createCrmContactSchema.shape.email.safeParse(address).success).toBe(false);
  });

  it("still accepts the ordinary addresses the schema accepts", () => {
    for (const address of ["jane@example.com", "j.smith+crm@sub.example.co.uk"]) {
      expect(parseEmail(address)).toBe(address);
      expect(createCrmContactSchema.shape.email.safeParse(address).success).toBe(true);
    }
  });
});

describe("clampText", () => {
  it("reports truncation", () => {
    expect(clampText("abcdef", 3)).toEqual({ value: "abc", truncated: true });
    expect(clampText("ab", 3)).toEqual({ value: "ab", truncated: false });
  });
});
