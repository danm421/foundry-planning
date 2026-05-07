import { db } from "@/db";
import {
  assetClasses,
  modelPortfolioAllocations,
  accountAssetAllocations,
  modelPortfolios,
  assetClassCorrelations,
} from "@/db/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import {
  DEFAULT_ASSET_CLASSES,
  DEFAULT_CORRELATIONS,
} from "./cma-seed";
import { canonicalPair } from "@/engine/monteCarlo/correlation-matrix";
import {
  buildMigrationPreview,
  validateMigrationRequest,
  type MigrationRequest,
} from "./cma-migration";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MigrationResult {
  addedAssetClasses: number;
  deletedAssetClasses: number;
  remappedAccountAllocations: number;
  remappedPortfolioAllocations: number;
  addedCorrelations: number;
  keptLegacy: number;
}

// Every standard class — Inflation included. Opted-in firms get the same set
// new firms get; no reason to omit Inflation just because the migration UI
// isn't structured around it.
const STANDARD_INSERTABLE = DEFAULT_ASSET_CLASSES;

/**
 * Migrate a firm's CMAs to the standard 14-asset set. The advisor pre-decides
 * what to do with each retired class via `request.remappings`:
 *   - `remap`    rewrite all account/portfolio allocations old → new (sum on
 *                collisions), then delete the old class
 *   - `keep`     leave the old class as-is alongside the new standard set
 *   - `delete`   delete outright (only valid if the class is unreferenced)
 *
 * Insert any standard classes the firm doesn't have, then fill in any missing
 * standard correlations (never overwrites custom ones). All in one transaction.
 */
export async function migrateFirmToStandard(
  firmId: string,
  request: MigrationRequest
): Promise<MigrationResult> {
  return await db.transaction(async (tx) => {
    // ── 1. Snapshot current state for the preview/validation pass ─────────
    const existing = await tx
      .select({ id: assetClasses.id, name: assetClasses.name })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));

    const existingCorrelationRows = await tx
      .select({
        idA: assetClassCorrelations.assetClassIdA,
        idB: assetClassCorrelations.assetClassIdB,
      })
      .from(assetClassCorrelations)
      .innerJoin(
        assetClasses,
        eq(assetClassCorrelations.assetClassIdA, assetClasses.id)
      )
      .where(eq(assetClasses.firmId, firmId));

    const refCounts = await loadReferenceCounts(tx, firmId);
    const preview = buildMigrationPreview(
      existing,
      existingCorrelationRows,
      refCounts
    );

    // Validate request shape against the preview (target names, missing keys,
    // delete-of-in-use, etc).
    const shapeError = validateMigrationRequest(preview, request);
    if (shapeError) throw new MigrationValidationError(shapeError);

    // ── 2. Insert any missing standard classes ────────────────────────────
    const existingNames = new Set(existing.map((c) => c.name));
    const toAdd = STANDARD_INSERTABLE.filter(
      (ac) => !existingNames.has(ac.name)
    );

    if (toAdd.length > 0) {
      const baseSort = existing.length;
      await tx.insert(assetClasses).values(
        toAdd.map((ac, i) => ({
          firmId,
          name: ac.name,
          slug: ac.slug,
          geometricReturn: String(ac.geometricReturn),
          arithmeticMean: String(ac.arithmeticMean),
          volatility: String(ac.volatility),
          pctOrdinaryIncome: String(ac.pctOrdinaryIncome),
          pctLtCapitalGains: String(ac.pctLtCapitalGains),
          pctQualifiedDividends: String(ac.pctQualifiedDividends),
          pctTaxExempt: String(ac.pctTaxExempt),
          sortOrder: baseSort + i,
          assetType: ac.assetType,
        }))
      );
    }

    // Refresh the firm-wide name → id map so newly-inserted standard classes
    // are resolvable as remap targets.
    const allClasses = await tx
      .select({ id: assetClasses.id, name: assetClasses.name })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    const nameToId = new Map(allClasses.map((c) => [c.name, c.id]));

    // ── 3. Execute remappings ─────────────────────────────────────────────
    let remappedAccountAllocations = 0;
    let remappedPortfolioAllocations = 0;
    let deletedAssetClasses = 0;
    let keptLegacy = 0;

    for (const removed of preview.assetClasses.removed) {
      const r = request.remappings[removed.id];
      if (!r) continue; // validation above guarantees this exists

      if (r.kind === "keep") {
        keptLegacy++;
        continue;
      }

      if (r.kind === "delete") {
        // Validation already checked reference count; just delete.
        await tx.delete(assetClasses).where(eq(assetClasses.id, removed.id));
        deletedAssetClasses++;
        continue;
      }

      // kind === "remap" — resolve target name → id (post-seed, all standard
      // classes exist). validateMigrationRequest already confirmed the name
      // is in `allTargetNames`; if it isn't in `nameToId` something is wrong.
      const toClassId = nameToId.get(r.toClassName);
      if (!toClassId) {
        throw new MigrationValidationError(
          `Remap target "${r.toClassName}" is not an asset class for this firm`
        );
      }

      remappedAccountAllocations += await mergeAccountAllocations(
        tx,
        removed.id,
        toClassId
      );
      remappedPortfolioAllocations += await mergePortfolioAllocations(
        tx,
        removed.id,
        toClassId
      );

      // Delete the now-unreferenced class. Cascade will clean up any
      // correlations the old class participated in.
      await tx.delete(assetClasses).where(eq(assetClasses.id, removed.id));
      deletedAssetClasses++;
    }

    // ── 5. Fill in any missing standard correlations ──────────────────────
    // Re-read correlations after potential cascade deletes from step 4.
    const correlationsNow = await tx
      .select({
        idA: assetClassCorrelations.assetClassIdA,
        idB: assetClassCorrelations.assetClassIdB,
      })
      .from(assetClassCorrelations)
      .innerJoin(
        assetClasses,
        eq(assetClassCorrelations.assetClassIdA, assetClasses.id)
      )
      .where(eq(assetClasses.firmId, firmId));
    const havePair = new Set(
      correlationsNow.map(({ idA, idB }) => canonicalKey(idA, idB))
    );

    const correlationRows = DEFAULT_CORRELATIONS.flatMap((c) => {
      const a = nameToId.get(c.classA);
      const b = nameToId.get(c.classB);
      if (!a || !b || a === b) return [];
      const [ca, cb] = canonicalPair(a, b);
      if (havePair.has(canonicalKey(ca, cb))) return [];
      return [{
        assetClassIdA: ca,
        assetClassIdB: cb,
        correlation: String(c.correlation),
      }];
    });

    let addedCorrelations = 0;
    if (correlationRows.length > 0) {
      await tx
        .insert(assetClassCorrelations)
        .values(correlationRows)
        .onConflictDoNothing({
          target: [
            assetClassCorrelations.assetClassIdA,
            assetClassCorrelations.assetClassIdB,
          ],
        });
      addedCorrelations = correlationRows.length;
    }

    return {
      addedAssetClasses: toAdd.length,
      deletedAssetClasses,
      remappedAccountAllocations,
      remappedPortfolioAllocations,
      addedCorrelations,
      keptLegacy,
    };
  });
}

async function mergeAccountAllocations(
  tx: Tx,
  oldClassId: string,
  newClassId: string
): Promise<number> {
  // Fetch source rows (those pointing at the legacy class) and any existing
  // target rows (already pointing at the new class) for the same accounts.
  const sourceRows = await tx
    .select()
    .from(accountAssetAllocations)
    .where(eq(accountAssetAllocations.assetClassId, oldClassId));
  if (sourceRows.length === 0) return 0;

  const accountIds = sourceRows.map((r) => r.accountId);
  const targetRows = await tx
    .select()
    .from(accountAssetAllocations)
    .where(
      and(
        eq(accountAssetAllocations.assetClassId, newClassId),
        inArray(accountAssetAllocations.accountId, accountIds)
      )
    );
  const targetByAccount = new Map(
    targetRows.map((r) => [r.accountId, r])
  );

  for (const src of sourceRows) {
    const existing = targetByAccount.get(src.accountId);
    if (existing) {
      const summed = Number(existing.weight) + Number(src.weight);
      await tx
        .update(accountAssetAllocations)
        .set({ weight: String(summed) })
        .where(eq(accountAssetAllocations.id, existing.id));
      await tx
        .delete(accountAssetAllocations)
        .where(eq(accountAssetAllocations.id, src.id));
    } else {
      await tx
        .update(accountAssetAllocations)
        .set({ assetClassId: newClassId })
        .where(eq(accountAssetAllocations.id, src.id));
    }
  }
  return sourceRows.length;
}

async function mergePortfolioAllocations(
  tx: Tx,
  oldClassId: string,
  newClassId: string
): Promise<number> {
  const sourceRows = await tx
    .select()
    .from(modelPortfolioAllocations)
    .where(eq(modelPortfolioAllocations.assetClassId, oldClassId));
  if (sourceRows.length === 0) return 0;

  const portfolioIds = sourceRows.map((r) => r.modelPortfolioId);
  const targetRows = await tx
    .select()
    .from(modelPortfolioAllocations)
    .where(
      and(
        eq(modelPortfolioAllocations.assetClassId, newClassId),
        inArray(modelPortfolioAllocations.modelPortfolioId, portfolioIds)
      )
    );
  const targetByPortfolio = new Map(
    targetRows.map((r) => [r.modelPortfolioId, r])
  );

  for (const src of sourceRows) {
    const existing = targetByPortfolio.get(src.modelPortfolioId);
    if (existing) {
      const summed = Number(existing.weight) + Number(src.weight);
      await tx
        .update(modelPortfolioAllocations)
        .set({ weight: String(summed) })
        .where(eq(modelPortfolioAllocations.id, existing.id));
      await tx
        .delete(modelPortfolioAllocations)
        .where(eq(modelPortfolioAllocations.id, src.id));
    } else {
      await tx
        .update(modelPortfolioAllocations)
        .set({ assetClassId: newClassId })
        .where(eq(modelPortfolioAllocations.id, src.id));
    }
  }
  return sourceRows.length;
}

async function loadReferenceCounts(
  tx: Tx,
  firmId: string
): Promise<Map<string, { accounts: number; portfolios: number }>> {
  const accountCounts = await tx
    .select({
      assetClassId: accountAssetAllocations.assetClassId,
      count: sql<number>`count(*)::int`,
    })
    .from(accountAssetAllocations)
    .innerJoin(
      assetClasses,
      eq(accountAssetAllocations.assetClassId, assetClasses.id)
    )
    .where(eq(assetClasses.firmId, firmId))
    .groupBy(accountAssetAllocations.assetClassId);

  const portfolioCounts = await tx
    .select({
      assetClassId: modelPortfolioAllocations.assetClassId,
      count: sql<number>`count(*)::int`,
    })
    .from(modelPortfolioAllocations)
    .innerJoin(
      modelPortfolios,
      eq(modelPortfolioAllocations.modelPortfolioId, modelPortfolios.id)
    )
    .where(eq(modelPortfolios.firmId, firmId))
    .groupBy(modelPortfolioAllocations.assetClassId);

  const out = new Map<string, { accounts: number; portfolios: number }>();
  for (const r of accountCounts) {
    const e = out.get(r.assetClassId) ?? { accounts: 0, portfolios: 0 };
    e.accounts = r.count;
    out.set(r.assetClassId, e);
  }
  for (const r of portfolioCounts) {
    const e = out.get(r.assetClassId) ?? { accounts: 0, portfolios: 0 };
    e.portfolios = r.count;
    out.set(r.assetClassId, e);
  }
  return out;
}

function canonicalKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class MigrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationValidationError";
  }
}

/** Read-only preview helper for the GET endpoint. Same logic as inside the
 *  transaction, exposed without mutating anything. */
export async function buildPreviewForFirm(firmId: string) {
  const existing = await db
    .select({ id: assetClasses.id, name: assetClasses.name })
    .from(assetClasses)
    .where(eq(assetClasses.firmId, firmId));

  const existingCorrelationRows = await db
    .select({
      idA: assetClassCorrelations.assetClassIdA,
      idB: assetClassCorrelations.assetClassIdB,
    })
    .from(assetClassCorrelations)
    .innerJoin(
      assetClasses,
      eq(assetClassCorrelations.assetClassIdA, assetClasses.id)
    )
    .where(eq(assetClasses.firmId, firmId));

  const refCounts = await db.transaction((tx) =>
    loadReferenceCounts(tx, firmId)
  );

  const preview = buildMigrationPreview(
    existing,
    existingCorrelationRows,
    refCounts
  );

  // Surface the unchanged + standard-class names → IDs for the UI's remap
  // dropdown. The UI needs IDs of every "potential remap target" — that's the
  // unchanged set today plus every standard class that's about to be inserted
  // (those don't have IDs yet, so we just hand back names; UI will show
  // unchanged classes as remap targets and disable kind=remap onto names that
  // aren't yet seeded — but in practice this only affects a fully-empty firm,
  // which has no removed classes anyway).
  return {
    ...preview,
    remapTargets: preview.assetClasses.unchanged.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    standardNamesNotYetSeeded: preview.assetClasses.added.map((a) => a.name),
  };
}

