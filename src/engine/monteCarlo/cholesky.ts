/**
 * Cholesky decomposition of a symmetric positive-definite matrix A into
 * a lower-triangular L such that L · Lᵀ = A.
 *
 * Used by the Monte Carlo return generator: given the covariance matrix of
 * log-space returns, L lets us turn an i.i.d. N(0, I) vector Z into a
 * correlated draw L·Z with the desired covariance structure.
 *
 * Standard Cholesky–Banachiewicz algorithm. Throws for non-square or
 * non-positive-definite input (caller must repair the matrix upstream).
 */
export function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length;
  for (const row of matrix) {
    if (row.length !== n) throw new Error("cholesky: matrix is not square");
  }

  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += L[i][k] * L[j][k];
      }
      if (i === j) {
        const diag = matrix[i][i] - sum;
        if (diag <= 0) {
          throw new Error(
            `cholesky: matrix is not positive-definite at pivot ${i} (diag = ${diag})`,
          );
        }
        L[i][j] = Math.sqrt(diag);
      } else {
        L[i][j] = (matrix[i][j] - sum) / L[j][j];
      }
    }
  }

  return L;
}

/** Compute L · Lᵀ for a lower-triangular L. Used by tests to verify round-trip. */
export function multiplyLowerTriangular(L: number[][]): number[][] {
  const n = L.length;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      // L is lower triangular, so L[i][k] and L[j][k] are nonzero only for k ≤ min(i, j).
      const kMax = Math.min(i, j);
      for (let k = 0; k <= kMax; k++) {
        sum += L[i][k] * L[j][k];
      }
      out[i][j] = sum;
    }
  }
  return out;
}
