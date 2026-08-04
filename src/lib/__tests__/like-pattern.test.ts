import { describe, it, expect } from "vitest";
import { escapeLikePattern, containsPattern } from "@/lib/like-pattern";

describe("escapeLikePattern", () => {
  it("leaves ordinary search text untouched", () => {
    expect(escapeLikePattern("Whole Foods")).toBe("Whole Foods");
  });

  it("escapes the LIKE wildcards", () => {
    expect(escapeLikePattern("%")).toBe("\\%");
    expect(escapeLikePattern("_")).toBe("\\_");
    expect(escapeLikePattern("50% off")).toBe("50\\% off");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("escapes the escape character itself, so `\\%` stays literal", () => {
    // Without this a user could write `\%` and have the backslash consume its
    // own escape, leaving the `%` live again.
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });
});

describe("containsPattern", () => {
  it("wraps in wildcards while keeping the user's text literal", () => {
    expect(containsPattern("Costco")).toBe("%Costco%");
  });

  it("a match-everything pattern degrades to a literal search", () => {
    // The bug this closes: a rule saved with pattern "%" drove a bulk UPDATE
    // over every transaction instead of matching the merchant "%".
    expect(containsPattern("%")).toBe("%\\%%");
  });
});
