import { describe, it, expect } from "vitest";
import {
  validateMembers,
  RESERVED_DEFAULT_KEYS,
  isReservedName,
  MemberValidationError,
} from "../mutations";

describe("isReservedName", () => {
  it("rejects reserved default keys (case-insensitive)", () => {
    expect(isReservedName("All-Liquid")).toBe(true);
    expect(isReservedName("taxable")).toBe(true);
    expect(isReservedName("RETIREMENT")).toBe(true);
    expect(isReservedName("Cash")).toBe(true);
  });
  it("allows non-reserved names", () => {
    expect(isReservedName("Long-term Growth")).toBe(false);
    expect(isReservedName("Spouse")).toBe(false);
  });
  it("RESERVED_DEFAULT_KEYS exposes the four keys", () => {
    expect([...RESERVED_DEFAULT_KEYS].sort()).toEqual([
      "all-liquid",
      "cash",
      "retirement",
      "taxable",
    ]);
  });
});

describe("validateMembers", () => {
  const clientAccounts = [
    { id: "a1", clientId: "c1", category: "taxable" as const },
    { id: "a2", clientId: "c1", category: "cash" as const },
    { id: "a3", clientId: "c1", category: "real_estate" as const },
    { id: "a4", clientId: "c2", category: "taxable" as const },
  ];

  it("passes when every requested member is a liquid account on this client", () => {
    expect(() =>
      validateMembers("c1", ["a1", "a2"], clientAccounts),
    ).not.toThrow();
  });

  it("throws MemberValidationError on an illiquid member", () => {
    expect(() => validateMembers("c1", ["a1", "a3"], clientAccounts)).toThrow(
      MemberValidationError,
    );
  });

  it("throws MemberValidationError on a cross-client account", () => {
    expect(() => validateMembers("c1", ["a1", "a4"], clientAccounts)).toThrow(
      MemberValidationError,
    );
  });

  it("throws MemberValidationError on an unknown account id", () => {
    expect(() => validateMembers("c1", ["ghost"], clientAccounts)).toThrow(
      MemberValidationError,
    );
  });

  it("allows an empty member list", () => {
    expect(() => validateMembers("c1", [], clientAccounts)).not.toThrow();
  });
});
