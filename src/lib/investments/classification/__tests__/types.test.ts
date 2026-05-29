import { describe, it, expect } from "vitest";
import { SECURITY_TYPES, isSecurityType } from "../types";

describe("classification types", () => {
  it("enumerates the security types", () => {
    expect(SECURITY_TYPES).toEqual([
      "etf", "mutual_fund", "stock", "bond", "cash", "other",
    ]);
  });

  it("validates security-type strings", () => {
    expect(isSecurityType("etf")).toBe(true);
    expect(isSecurityType("crypto")).toBe(false);
  });
});
