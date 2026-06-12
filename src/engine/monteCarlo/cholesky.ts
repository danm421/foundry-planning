/**
 * Cholesky decomposition of a symmetric positive-definite matrix A into
 * a lower-triangular L such that L · Lᵀ = A.
 *
 * Used by the Monte Carlo return generator: given the covariance matrix of
 * log-space returns, L lets us turn an i.i.d. N(0, I) vector Z into a
 * correlated draw L·Z with the desired covariance structure.
 *
 * Standard Cholesky–Banachiewicz algorithm. PSD-tolerant: a (near-)zero
 * pivot is treated as a deterministic, zero-variance dimension (L[i][i] = 0,
 * its column stays 0) rather than an error. A genuinely negative pivot means
 * the matrix is indefinite (a real upstream bug) and still throws. Throws for
 * non-square input.
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
        // A clearly-negative pivot means the matrix is indefinite (a real bug
        // upstream) — still fatal. A (near-)zero pivot is a deterministic
        // dimension (a zero-variance asset): L[i][i] = 0 and its column stays 0.
        if (diag < -1e-12) {
          throw new Error(
            `cholesky: matrix is not positive-definite at pivot ${i} (diag = ${diag})`,
          );
        }
        L[i][j] = diag > 0 ? Math.sqrt(diag) : 0;
      } else {
        // When the pivot column is degenerate (L[j][j] === 0), the matching
        // covariance entry is necessarily 0 for a consistent PSD matrix → 0.
        L[i][j] = L[j][j] === 0 ? 0 : (matrix[i][j] - sum) / L[j][j];
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
