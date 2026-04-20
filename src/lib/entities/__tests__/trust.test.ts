import { describe, it, expect } from "vitest";
import {
  TRUST_SUB_TYPES,
  REVOCABLE_SUB_TYPES,
  deriveIsIrrevocable,
  type TrustSubType,
} from "../trust";

describe("TRUST_SUB_TYPES", () => {
  it("lists the ten expected values in order", () => {
    expect(TRUST_SUB_TYPES).toEqual([
      "revocable",
      "irrevocable",
      "ilit",
      "slat",
      "crt",
      "grat",
      "qprt",
      "clat",
      "qtip",
      "bypass",
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
    ["slat", true],
    ["crt", true],
    ["grat", true],
    ["qprt", true],
    ["clat", true],
    ["qtip", true],
    ["bypass", true],
  ];
  it.each(cases)("%s → %s", (sub, expected) => {
    expect(deriveIsIrrevocable(sub)).toBe(expected);
  });
});
