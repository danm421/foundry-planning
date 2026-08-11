// Server-side read of the advisor's portal feature switches. Split from
// `features.ts` so the pure constants there stay importable from client
// components without dragging `@/db` into the browser bundle.
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { ForbiddenError } from "@/lib/authz";
import {
  portalFeatureLabel,
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
 * Wrapped in React.cache like `getPortalClientRef` and `requireClientAccess`,
 * so the Budget layout's gate and any page gate below it share one query.
 * NB that only holds under a React render — `cache()` has no dispatcher inside
 * a route handler and falls through to a plain call, so `/api/portal/*` pays a
 * query per gate. Hence `assertPortalFeature` for callers already holding the
 * row.
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
 * Page-level gate for the switchable portal sections. Callers render the
 * section-unavailable screen on false — the section is gone for this client,
 * which is also what the navs show.
 */
export async function isPortalFeatureEnabled(
  clientId: string,
  feature: PortalFeatureKey,
): Promise<boolean> {
  const features = await loadPortalFeatures(clientId);
  return features[feature];
}

/**
 * Route-handler gate for the `/api/portal/*` endpoints a switched-off section
 * owns — the JSON counterpart of the page gate above. Without it, hiding the
 * rail entry and 404ing the page still leaves the data one fetch away, from a
 * bookmarked URL or a mobile build that predates the switch.
 *
 * Applies in advisor act-as-client preview too, unlike `requireAreaShared`:
 * this is the advisor's own switch, and a preview that answered where the real
 * portal 403s would stop being a preview.
 *
 * Not a security boundary — it is the client's own data either way. It is the
 * scope of the portal the advisor sold them.
 */
export async function requirePortalFeature(
  clientId: string,
  feature: PortalFeatureKey,
): Promise<void> {
  assertPortalFeature(await loadPortalFeatures(clientId), feature);
}

/**
 * The same gate for a caller that already has the switches in hand — spread
 * `portalFeatureColumns` into a `clients` select it was making anyway and
 * project with `toPortalFeatures`. Saves the round trip `requirePortalFeature`
 * would add, which `cache()` does not dedupe outside a render.
 */
export function assertPortalFeature(
  features: PortalFeatures,
  feature: PortalFeatureKey,
): void {
  if (features[feature]) return;
  throw new ForbiddenError(
    `Your advisor has not enabled ${portalFeatureLabel(feature)} for this portal`,
  );
}
