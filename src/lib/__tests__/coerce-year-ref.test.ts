import { describe, it, expect } from "vitest";
import { coerceYearRef } from "@/lib/milestones";

describe("coerceYearRef", () => {
  it("accepts a valid year ref", () => {
    expect(coerceYearRef("client_retirement")).toBe("client_retirement");
    expect(coerceYearRef("plan_start")).toBe("plan_start");
    expect(coerceYearRef("spouse_ss_70")).toBe("spouse_ss_70");
  });

  it("drops an unknown token", () => {
    expect(coerceYearRef("retirement")).toBeUndefined();
    expect(coerceYearRef("CLIENT_RETIREMENT")).toBeUndefined();
    expect(coerceYearRef("")).toBeUndefined();
  });

  it("drops non-string input", () => {
    expect(coerceYearRef(undefined)).toBeUndefined();
    expect(coerceYearRef(null)).toBeUndefined();
    expect(coerceYearRef(2035)).toBeUndefined();
  });
});
