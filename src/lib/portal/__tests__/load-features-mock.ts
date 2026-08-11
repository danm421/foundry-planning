// Shared `vi.mock` body for `@/lib/portal/load-features` — every section
// switched on.
//
// Route tests that mock this module are testing the route, not the switches
// (those have their own tests: `require-portal-feature`, `feature-gate-403`,
// `feature-gate-coverage`). Point them here rather than at a hand-rolled
// factory per file, so a new export on the real module can't leave a dozen
// tests silently stubbing it to `undefined`:
//
//   vi.mock("@/lib/portal/load-features", () => import("@/lib/portal/__tests__/load-features-mock"));
import { DEFAULT_PORTAL_FEATURES, type PortalFeatures } from "@/lib/portal/features";

/** Column map only ever spread into a `db.select()`; the db doubles ignore it. */
export const portalFeatureColumns = {
  portalInvestmentsEnabled: "portal_investments_enabled",
  portalBudgetEnabled: "portal_budget_enabled",
  portalDocumentsEnabled: "portal_documents_enabled",
};

export const loadPortalFeatures = (): Promise<PortalFeatures> =>
  Promise.resolve(DEFAULT_PORTAL_FEATURES);

export const isPortalFeatureEnabled = (): Promise<boolean> => Promise.resolve(true);

export const requirePortalFeature = (): Promise<void> => Promise.resolve();
