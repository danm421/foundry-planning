// src/lib/insights/cma-bounds.ts
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEFAULTS = { cashReturn: 0.02, equityReturn: 0.07 };

/** Firm real geometric return bounds for the growth axis (cash → equity). */
export async function loadCmaReturnBounds(
  firmId: string,
): Promise<{ cashReturn: number; equityReturn: number }> {
  const rows = await db
    .select({
      assetType: assetClasses.assetType,
      slug: assetClasses.slug,
      geo: assetClasses.geometricReturn,
    })
    .from(assetClasses)
    .where(eq(assetClasses.firmId, firmId));

  if (rows.length === 0) return DEFAULTS;

  const cashRow =
    rows.find((r) => r.slug === "cash") ??
    rows.find((r) => r.assetType === "cash");
  const equityGeos = rows
    .filter((r) => r.assetType === "equities")
    .map((r) => Number(r.geo));

  const cashReturn = cashRow ? Number(cashRow.geo) : DEFAULTS.cashReturn;
  const equityReturn =
    equityGeos.length > 0 ? Math.max(...equityGeos) : DEFAULTS.equityReturn;

  // Guard against degenerate CMA (equity ≤ cash) so the axis stays orderable.
  if (equityReturn <= cashReturn) return DEFAULTS;
  return { cashReturn, equityReturn };
}
