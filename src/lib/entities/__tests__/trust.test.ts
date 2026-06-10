import { describe, it, expect } from "vitest";
import {
  TRUST_SUB_TYPES,
  deriveIsIrrevocable,
  type TrustSubType,
} from "../trust";

describe("TRUST_SUB_TYPES", () => {
  it("lists the expected values in order", () => {
    expect(TRUST_SUB_TYPES).toEqual([
      "irrevocable",
      "ilit",
      "clt",
      "idgt",
      "crt",
    ]);
  });
});

describe("deriveIsIrrevocable", () => {
  const cases: Array<[TrustSubType, boolean]> = [
    ["irrevocable", true],
    ["ilit", true],
    ["clt", true],
    ["crt", true],
    ["idgt", true],
  ];
  it.each(cases)("%s → %s", (sub, expected) => {
    expect(deriveIsIrrevocable(sub)).toBe(expected);
  });
});
