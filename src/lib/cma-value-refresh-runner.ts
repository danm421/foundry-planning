import { db } from "@/db";
import { assetClasses, assetClassCorrelations } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_ASSET_CLASSES, DEFAULT_CORRELATIONS } from "./cma-seed";
import {
  buildCorrelationMatrix,
  canonicalPair,
} from "@/engine/monteCarlo/correlation-matrix";
import { cholesky } from "@/engine/monteCarlo/cholesky";
import {
  buildValueRefreshPreview,
  validateRefreshRequest,
  type ValueRefreshRequest,
  type ValueRefreshPreview,
  type ExistingValueClass,
  type ExistingCorrelation,
} from "./cma-value-refresh";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ValueRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueRefreshError";
  }
}

export interface ValueRefreshResult {
  updatedClasses: number;
  refreshedCorrelationPairs: number;
}

const STANDARD_BY_NAME = new Map(DEFAULT_ASSET_CLASSES.map((ac) => [ac.name, ac]));

// Shared projection so the read path (preview) and write path (runner) return
// the exact ExistingValueClass shape from a single source of truth.
const VALUE_CLASS_COLUMNS = {
  id: assetClasses.id,
  name: assetClasses.name,
  geometricReturn: assetClasses.geometricReturn,
  arithmeticMean: assetClasses.arithmeticMean,
  volatility: assetClasses.volatility,
  pctOrdinaryIncome: assetClasses.pctOrdinaryIncome,
  pctLtCapitalGains: assetClasses.pctLtCapitalGains,
  pctQualifiedDividends: assetClasses.pctQualifiedDividends,
  pctTaxExempt: assetClasses.pctTaxExempt,
  assetType: assetClasses.assetType,
} as const;

const CORRELATION_COLUMNS = {
  idA: assetClassCorrelations.assetClassIdA,
  idB: assetClassCorrelations.assetClassIdB,
  correlation: assetClassCorrelations.correlation,
} as const;

function readClasses(tx: Tx, firmId: string): Promise<ExistingValueClass[]> {
  return tx.select(VALUE_CLASS_COLUMNS).from(assetClasses).where(eq(assetClasses.firmId, firmId));
}

// Correlations are firm-internal (both ids belong to the same firm), so joining
// on the A side is enough to scope to the firm — same approach as cma-migration-runner.
function readCorrelations(tx: Tx, firmId: string): Promise<ExistingCorrelation[]> {
  return tx
    .select(CORRELATION_COLUMNS)
    .from(assetClassCorrelations)
    .innerJoin(assetClasses, eq(assetClassCorrelations.assetClassIdA, assetClasses.id))
    .where(eq(assetClasses.firmId, firmId));
}

/** Read-only preview for the GET route. Wrapped in a tx purely to reuse the
 *  readClasses/readCorrelations helpers (typed against the tx client). */
export async function buildValueRefreshPreviewForFirm(
  firmId: string,
): Promise<ValueRefreshPreview> {
  return db.transaction(async (tx) => {
    const classes = await readClasses(tx, firmId);
    const correlations = await readCorrelations(tx, firmId);
    return buildValueRefreshPreview(classes, correlations);
  });
}

export async function refreshFirmStandardValues(
  firmId: string,
  request: ValueRefreshRequest,
): Promise<ValueRefreshResult> {
  return db.transaction(async (tx) => {
    const existing = await readClasses(tx, firmId);
    const correlations = await readCorrelations(tx, firmId);
    const preview = buildValueRefreshPreview(existing, correlations);

    const err = validateRefreshRequest(preview, request);
    if (err) throw new ValueRefreshError(err);

    // 1. Update opted-in classes to the standard values.
    const byId = new Map(existing.map((c) => [c.id, c]));
    let updatedClasses = 0;
    for (const classId of request.classIds) {
      const row = byId.get(classId);
      if (!row) continue; // validated above; defensive
      const def = STANDARD_BY_NAME.get(row.name);
      if (!def) continue;
      await tx
        .update(assetClasses)
        .set({
          geometricReturn: String(def.geometricReturn),
          arithmeticMean: String(def.arithmeticMean),
          volatility: String(def.volatility),
          pctOrdinaryIncome: String(def.pctOrdinaryIncome),
          pctLtCapitalGains: String(def.pctLtCapitalGains),
          pctQualifiedDividends: String(def.pctQualifiedDividends),
          pctTaxExempt: String(def.pctTaxExempt),
          assetType: def.assetType,
          updatedAt: new Date(),
        })
        .where(eq(assetClasses.id, classId));
      updatedClasses++;
    }

    // 2. Replace the standard↔standard correlation block (all-or-nothing).
    //    DEFAULT_CORRELATIONS is exactly the full standard matrix, so upserting
    //    every default pair restores the whole block. Pairs involving a legacy
    //    class (or Inflation) aren't in DEFAULT_CORRELATIONS and are left alone.
    let refreshedCorrelationPairs = 0;
    if (request.refreshCorrelations) {
      const nameToId = new Map(existing.map((c) => [c.name, c.id]));
      const rows = DEFAULT_CORRELATIONS.flatMap((dc) => {
        const a = nameToId.get(dc.classA);
        const b = nameToId.get(dc.classB);
        if (!a || !b || a === b) return [];
        const [ca, cb] = canonicalPair(a, b);
        return [{ assetClassIdA: ca, assetClassIdB: cb, correlation: String(dc.correlation) }];
      });
      if (rows.length > 0) {
        await tx
          .insert(assetClassCorrelations)
          .values(rows)
          .onConflictDoUpdate({
            target: [
              assetClassCorrelations.assetClassIdA,
              assetClassCorrelations.assetClassIdB,
            ],
            set: { correlation: sql`excluded.correlation`, updatedAt: new Date() },
          });
        refreshedCorrelationPairs = rows.length;
      }

      // 3. PD guard — only correlations can break positive-definiteness, so only
      //    check when they changed. Build the firm's full matrix and run Cholesky;
      //    a throw means Monte Carlo would crash, so abort (rolls back the tx).
      const finalClasses = await tx
        .select({ id: assetClasses.id })
        .from(assetClasses)
        .where(eq(assetClasses.firmId, firmId));
      const finalCorrs = await readCorrelations(tx, firmId);
      const matrix = buildCorrelationMatrix(
        finalClasses.map((c) => c.id),
        finalCorrs.map((c) => ({
          assetClassIdA: c.idA,
          assetClassIdB: c.idB,
          correlation: c.correlation,
        })),
      );
      try {
        cholesky(matrix);
      } catch {
        throw new ValueRefreshError(
          "Adopting the standard correlation matrix would make this firm's matrix invalid for simulations (not positive-definite). No changes were applied.",
        );
      }
    }

    return { updatedClasses, refreshedCorrelationPairs };
  });
}
