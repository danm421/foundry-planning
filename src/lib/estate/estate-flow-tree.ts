import type { ClientData } from "@/engine/types";
import { hasSpouseForEstate } from "@/lib/estate/spousal-household";

/**
 * Post-process an effective tree into EstateFlowView inputs. Shared by the
 * estate-flow page loader and the onboarding Estate step so the two can't
 * drift.
 *
 * - `giftFreeTree` strips the loader's baked-in gifts — the view
 *   re-materialises them from `workingGifts` (single source of truth).
 * - `cpi` drives the gift-series fan-out. resolvedInflationRate is not exposed
 *   on ClientData (it lives on the loader's ResolutionContext), so this is the
 *   raw plan-settings inflation rate — the only inflation field reachable here.
 * - `isMarried` gates the second-death column on spouse existence, matching
 *   the engine's second-death signal (client.spouseDob) — NOT filing status.
 *   See hasSpouseForEstate.
 */
export function prepareEstateFlowTree(effectiveTree: ClientData): {
  giftFreeTree: ClientData;
  cpi: number;
  isMarried: boolean;
} {
  return {
    giftFreeTree: { ...effectiveTree, gifts: [], giftEvents: [] },
    cpi: effectiveTree.planSettings.inflationRate,
    isMarried: hasSpouseForEstate(effectiveTree.client.spouseDob),
  };
}
