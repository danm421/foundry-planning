import { describe, it, expect } from "vitest";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { fmtValue, fmtFieldValue } from "../format";

describe("fmtValue — a value that is not a scalar", () => {
  // THE RED. Reproduced on the Warner household 2026-08-12: six of seven
  // strategy cards printed this on a client page.
  it("never renders an object as [object Object]", () => {
    expect(fmtValue([{ id: "a" }, { id: "b" }])).not.toContain("[object Object]");
  });

  it("renders an array of objects as a neutral placeholder", () => {
    expect(fmtValue([{ id: "a" }, { id: "b" }])).toBe("—");
  });

  it("renders a bare object as the same placeholder", () => {
    expect(fmtValue({ id: "a" })).toBe("—");
  });

  it("still renders an array of strings by joining them", () => {
    expect(fmtValue(["Cooper", "Susan"])).toBe("Cooper, Susan");
  });

  it("leaves every scalar exactly as it was", () => {
    expect(fmtValue(null)).toBe("—");
    expect(fmtValue("")).toBe("—");
    expect(fmtValue(true)).toBe("Yes");
    expect(fmtValue(2032)).toBe("2032");
    expect(fmtValue(45_600)).toBe("$46k");
    expect(fmtValue(4.5)).toBe("4.5");
  });
});

describe("fmtFieldValue — a value that needs its field to be readable", () => {
  // THE RED. `fmtValue` ends in `String(v)`, so the stored token for the
  // household's second person printed verbatim into a Scenario Changes diff
  // cell — a client deliverable.
  it("never renders the raw person enum", () => {
    expect(fmtFieldValue("owner", "spouse")).toBe(CO_CLIENT_LABEL);
    expect(fmtFieldValue("grantor", "spouse")).toBe(CO_CLIENT_LABEL);
  });

  it("labels every value the person enum can hold", () => {
    expect(fmtFieldValue("owner", "client")).toBe("Client");
    expect(fmtFieldValue("owner", "joint")).toBe("Joint");
  });

  it("leaves an owner-ish field that carries an id alone", () => {
    expect(fmtFieldValue("ownerEntityId", "spouse-trust-1")).toBe("spouse-trust-1");
    expect(fmtFieldValue("ownerAccountId", "abc-123")).toBe("abc-123");
  });

  it("falls through for an unrecognised token rather than guessing", () => {
    expect(fmtFieldValue("owner", "trust")).toBe("trust");
  });

  it("formats every other field exactly as fmtValue does", () => {
    expect(fmtFieldValue("annualAmount", 45_600)).toBe("$46k");
    expect(fmtFieldValue("startYear", 2032)).toBe("2032");
    expect(fmtFieldValue("owner", null)).toBe("—");
  });
});
