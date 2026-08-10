// Server-side read of the advisor's portal feature switches. Split from
// `features.ts` so the pure constants there stay importable from client
// components without dragging `@/db` into the browser bundle.
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  toPortalFeatures,
  type PortalFeatureKey,
  type PortalFeatures,
} from "@/lib/portal/features";

/**
 * Spread into any `db.select()` on `clients` that already reads the row for
 * other reasons; pair with `toPortalFeatures` to project the result.
 */
export const portalFeatureColumns = {
  portalInvestmentsEnabled: clients.portalInvestmentsEnabled,
  portalBudgetEnabled: clients.portalBudgetEnabled,
  portalDocumentsEnabled: clients.portalDocumentsEnabled,
};

/**
 * Missing client row → everything on. A client that doesn't resolve is a
 * different failure (the access gates catch it); defaulting to "off" here
 * would present it as an empty portal instead.
 *
 * Wrapped in React.cache like `getPortalClientRef` and `requireClientAccess`:
 * the Budget layout's gate and any page gate below it share one query per
 * request.
 */
export const loadPortalFeatures = cache(
  async (clientId: string): Promise<PortalFeatures> => {
    const [row] = await db
      .select(portalFeatureColumns)
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    return toPortalFeatures(row);
  },
);

/**
 * Page-level gate for the switchable portal sections. Callers `notFound()` on
 * false — the section simply doesn't exist for this client, which is also what
 * the navs show.
 */
export async function isPortalFeatureEnabled(
  clientId: string,
  feature: PortalFeatureKey,
): Promise<boolean> {
  const features = await loadPortalFeatures(clientId);
  return features[feature];
}
