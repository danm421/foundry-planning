import { db } from "@/db";
import { assetClasses, cmaSets, cmaSetValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { mirrorActiveSetToAssetClasses } from "./cma-sets";
import {
  buildProjectedValueRefreshPreview,
  validateProjectedRefreshRequest,
  resolveProjectedClass,
  type ExistingProjectedClass,
  type ProjectedValueRefreshPreview,
  type ProjectedValueRefreshRequest,
} from "./cma-projected-value-refresh";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ProjectedValueRefreshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectedValueRefreshError";
  }
}

export interface ProjectedValueRefreshResult {
  updatedClasses: number;
}

// Projection shared by the read (preview) and write (runner) paths: the firm's
// projected cma_set_values joined to each class's name/slug.
const PROJECTED_VALUE_COLUMNS = {
  id: assetClasses.id,
  name: assetClasses.name,
  slug: assetClasses.slug,
  geometricReturn: cmaSetValues.geometricReturn,
  arithmeticMean: cmaSetValues.arithmeticMean,
  volatility: cmaSetValues.volatility,
} as const;

function readProjectedValues(tx: Tx, firmId: string): Promise<ExistingProjectedClass[]> {
  return tx
    .select(PROJECTED_VALUE_COLUMNS)
    .from(cmaSetValues)
    .innerJoin(cmaSets, eq(cmaSetValues.cmaSetId, cmaSets.id))
    .innerJoin(assetClasses, eq(cmaSetValues.assetClassId, assetClasses.id))
    .where(
      and(
        eq(cmaSets.firmId, firmId),
        eq(cmaSets.key, "projected"),
        eq(assetClasses.firmId, firmId),
      ),
    );
}

/** Read-only preview for the GET route. Wrapped in a tx purely to reuse the
 *  readProjectedValues helper (typed against the tx client). */
export async function buildProjectedValueRefreshPreviewForFirm(
  firmId: string,
): Promise<ProjectedValueRefreshPreview> {
  return db.transaction(async (tx) => {
    const existing = await readProjectedValues(tx, firmId);
    return buildProjectedValueRefreshPreview(existing);
  });
}

export async function refreshFirmProjectedValues(
  firmId: string,
  request: ProjectedValueRefreshRequest,
): Promise<ProjectedValueRefreshResult> {
  return db.transaction(async (tx) => {
    const [projectedSet] = await tx
      .select()
      .from(cmaSets)
      .where(and(eq(cmaSets.firmId, firmId), eq(cmaSets.key, "projected")));
    if (!projectedSet) {
      throw new ProjectedValueRefreshError("This firm has no Projected CMA set.");
    }

    const existing = await readProjectedValues(tx, firmId);
    const preview = buildProjectedValueRefreshPreview(existing);
    const err = validateProjectedRefreshRequest(preview, request);
    if (err) throw new ProjectedValueRefreshError(err);

    // Write the generated numbers into the projected set's cma_set_values (the
    // durable per-set store) for each selected, mapped class.
    const byId = new Map(existing.map((c) => [c.id, c]));
    let updatedClasses = 0;
    for (const classId of request.classIds) {
      const row = byId.get(classId);
      if (!row) continue; // validated above; defensive
      const gen = resolveProjectedClass(row.name, row.slug);
      if (!gen) continue;
      await tx
        .update(cmaSetValues)
        .set({
          geometricReturn: String(gen.geometricReturn),
          arithmeticMean: String(gen.arithmeticMean),
          volatility: String(gen.volatility),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cmaSetValues.cmaSetId, projectedSet.id),
            eq(cmaSetValues.assetClassId, classId),
          ),
        );
      updatedClasses++;
    }

    // Reconcile asset_classes' numeric columns to the projected numbers ONLY if
    // projected is the active set. When another set is active, the new projected
    // numbers stay durable in cma_set_values but must not overwrite the mirror.
    if (projectedSet.isActive && updatedClasses > 0) {
      await mirrorActiveSetToAssetClasses(tx, firmId, request.classIds);
    }

    return { updatedClasses };
  });
}
