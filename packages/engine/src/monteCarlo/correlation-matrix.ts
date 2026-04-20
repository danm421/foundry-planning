/**
 * Helpers for the `asset_class_correlations` table: storage is canonical (one
 * row per pair with idA < idB), but the Monte Carlo engine wants a full
 * symmetric matrix indexed by the asset classes "used" in a given run.
 */

export interface CorrelationRow {
  assetClassIdA: string;
  assetClassIdB: string;
  /** Stored as Drizzle `numeric` → string over the wire; tolerate both. */
  correlation: number | string;
}

/** Return (a, b) such that a ≤ b. Used when writing or looking up pairs. */
export function canonicalPair<T extends string>(x: T, y: T): [T, T] {
  return x <= y ? [x, y] : [y, x];
}

/**
 * Build an N×N symmetric correlation matrix from a list of asset-class ids
 * (order determines matrix row/col order) and the raw correlation rows from
 * the DB. The diagonal is 1; missing pairs default to 0 (independent, per the
 * eMoney whitepaper's custom-index fallback, p.5). Rows referencing ids not
 * in `ids` are silently dropped — keeps the "used indices" filter simple at
 * the call site.
 */
export function buildCorrelationMatrix(
  ids: string[],
  rows: CorrelationRow[],
): number[][] {
  const n = ids.length;
  const indexOf = new Map<string, number>();
  for (let i = 0; i < n; i++) indexOf.set(ids[i], i);

  const M: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) M[i][i] = 1;

  for (const row of rows) {
    const i = indexOf.get(row.assetClassIdA);
    const j = indexOf.get(row.assetClassIdB);
    if (i === undefined || j === undefined) continue;
    const rho = typeof row.correlation === "string" ? parseFloat(row.correlation) : row.correlation;
    if (!Number.isFinite(rho) || rho < -1 || rho > 1) {
      throw new Error(
        `buildCorrelationMatrix: correlation ${rho} for (${row.assetClassIdA}, ${row.assetClassIdB}) is outside [-1, 1]`,
      );
    }
    M[i][j] = rho;
    M[j][i] = rho;
  }

  return M;
}
