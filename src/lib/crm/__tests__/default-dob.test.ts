import { describe, it, expect } from "vitest";
import { defaultAdultDateOfBirth, resolveContactDateOfBirth } from "../default-dob";

describe("defaultAdultDateOfBirth", () => {
  it("returns Jan 1 of the year that makes them 50 today", () => {
    expect(defaultAdultDateOfBirth(new Date("2026-06-08"))).toBe("1976-01-01");
  });
});

describe("resolveContactDateOfBirth", () => {
  it("keeps an entered DOB for any role", () => {
    expect(resolveContactDateOfBirth("primary", "1965-04-02")).toBe("1965-04-02");
    expect(resolveContactDateOfBirth("dependent", "2015-04-02")).toBe("2015-04-02");
  });

  it("defaults a blank adult DOB to the age-50 placeholder", () => {
    const expected = defaultAdultDateOfBirth();
    expect(resolveContactDateOfBirth("primary", undefined)).toBe(expected);
    expect(resolveContactDateOfBirth("spouse", undefined)).toBe(expected);
  });

  it("never invents a DOB for dependents or other contacts", () => {
    expect(resolveContactDateOfBirth("dependent", undefined)).toBeUndefined();
    expect(resolveContactDateOfBirth("other", undefined)).toBeUndefined();
  });
});
