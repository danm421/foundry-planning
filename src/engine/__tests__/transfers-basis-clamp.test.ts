import { describe, it, expect } from "vitest";
import { creditTransferBasis } from "../transfers";

describe("creditTransferBasis — §165 underwater transfer guard", () => {
  it("credits the full basisReturn when the source holds a gain", () => {
    // $10k moved, $6k of basis consumed → target receives $6k of basis.
    expect(creditTransferBasis(6_000, 10_000)).toBe(6_000);
  });

  it("clamps to dollars moved when the source is underwater", () => {
    // A $10k draw from a 2x-basis account consumes $20k of basis. Crediting
    // the raw figure would hand the target $20k of basis for $10k received.
    expect(creditTransferBasis(20_000, 10_000)).toBe(10_000);
  });

  it("is exact at the boundary", () => {
    expect(creditTransferBasis(10_000, 10_000)).toBe(10_000);
  });

  it("never returns a negative credit", () => {
    expect(creditTransferBasis(0, 10_000)).toBe(0);
  });
});
