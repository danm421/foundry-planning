import { describe, it, expect } from "vitest";
import { cholesky, multiplyLowerTriangular } from "../cholesky";

describe("cholesky — eMoney whitepaper golden values", () => {
  it("matches the whitepaper p.9 covariance → L decomposition", () => {
    const cov = [
      [0.01845, 0.02003, 0.01820],
      [0.02003, 0.02267, 0.01904],
      [0.01820, 0.01904, 0.01853],
    ];
    const L = cholesky(cov);
    const expected = [
      [0.13584, 0, 0],
      [0.14748, 0.03025, 0],
      [0.13399, -0.02399, 0.00127],
    ];
    // The PDF's printed covariance and printed L are NOT self-consistent at
    // 5 dp — e.g. recomputing L[1][1] from the printed covariance yields
    // ~0.03041, but the PDF prints 0.03025. Doc values were computed at
    // higher precision and rounded independently, so the 5-dp cov and 5-dp L
    // don't round-trip through each other. Loose match (2 dp, ±0.005) here
    // for sanity; the mathematical identity L·Lᵀ = cov is the authoritative
    // correctness test and is asserted to 10 dp in the next describe block.
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(L[i][j]).toBeCloseTo(expected[i][j], 2);
      }
    }
  });
});

describe("cholesky — fundamental properties", () => {
  it("returns lower-triangular (zeros above diagonal)", () => {
    const cov = [
      [1, 0.5, 0.3],
      [0.5, 1, 0.2],
      [0.3, 0.2, 1],
    ];
    const L = cholesky(cov);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        expect(L[i][j]).toBe(0);
      }
    }
  });

  it("reconstructs the input via L·Lᵀ", () => {
    const cov = [
      [4, 2, 0.6],
      [2, 3, 0.5],
      [0.6, 0.5, 2],
    ];
    const L = cholesky(cov);
    const LLt = multiplyLowerTriangular(L);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(LLt[i][j]).toBeCloseTo(cov[i][j], 10);
      }
    }
  });

  it("handles the 1×1 case", () => {
    const L = cholesky([[9]]);
    expect(L).toEqual([[3]]);
  });

  it("handles the identity matrix", () => {
    const I = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const L = cholesky(I);
    expect(L).toEqual(I);
  });

  it("throws for a non-positive-definite matrix", () => {
    // Zero on diagonal → singular, not PD.
    expect(() => cholesky([
      [1, 1],
      [1, 1],
    ])).toThrow();
  });

  it("throws for a non-square matrix", () => {
    expect(() => cholesky([
      [1, 0, 0],
      [0, 1, 0],
    ])).toThrow();
  });
});
