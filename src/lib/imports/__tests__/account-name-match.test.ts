import { describe, expect, it } from "vitest";
import { normalizeAccountName, resolveAccountName } from "../account-name-match";

describe("normalizeAccountName", () => {
  it("strips case, punctuation and spacing", () => {
    expect(normalizeAccountName("401(k) - Fidelity")).toBe("401kfidelity");
    expect(normalizeAccountName("401k fidelity")).toBe("401kfidelity");
  });
});

describe("resolveAccountName", () => {
  const NAMES = ["Zach 401(k)", "401(k) - Fidelity", "Taxable Investment 1"];

  it("prefers an exact match", () => {
    expect(resolveAccountName("Zach 401(k)", NAMES)).toBe("Zach 401(k)");
  });

  it("falls back to the normalized form and returns the canonical name", () => {
    expect(resolveAccountName("401k fidelity", NAMES)).toBe("401(k) - Fidelity");
  });

  it("returns undefined when nothing matches", () => {
    // The pay-stub default: an employer-derived name with no account behind it.
    expect(resolveAccountName("Acme Corp 401(k)", NAMES)).toBeUndefined();
  });

  it("treats a blank destination as unresolved", () => {
    expect(resolveAccountName("", NAMES)).toBeUndefined();
  });

  // An exact match must win even when an earlier entry normalizes the same, or
  // the UI would show the advisor a different account than commit attaches to.
  it("does not let a normalized collision shadow an exact match", () => {
    expect(resolveAccountName("401k fidelity", ["401(k) Fidelity", "401k fidelity"]))
      .toBe("401k fidelity");
  });
});
