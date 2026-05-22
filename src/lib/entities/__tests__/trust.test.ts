import { describe, it, expect } from "vitest";
import {
  TRUST_SUB_TYPES,
  REVOCABLE_SUB_TYPES,
  deriveIsIrrevocable,
  type TrustSubType,
} from "../trust";

describe("TRUST_SUB_TYPES", () => {
  it("lists the expected values in order", () => {
    expect(TRUST_SUB_TYPES).toEqual([
      "revocable",
      "irrevocable",
      "ilit",
      "clt",
      "idgt",
    ]);
  });
});

describe("REVOCABLE_SUB_TYPES", () => {
  it("contains only 'revocable'", () => {
    expect([...REVOCABLE_SUB_TYPES]).toEqual(["revocable"]);
  });
});

describe("deriveIsIrrevocable", () => {
  const cases: Array<[TrustSubType, boolean]> = [
    ["revocable", false],
    ["irrevocable", true],
    ["ilit", true],
    ["clt", true],
  ];
  it.each(cases)("%s → %s", (sub, expected) => {
    expect(deriveIsIrrevocable(sub)).toBe(expected);
  });
});
