// Shared adapter helpers for the estate presentation pages (Transfer,
// Liquidity, Gift Tax). Each estate view-model derives owner info from
// clientData, selects the natural death ordering, and shares the callout rule.

import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import type { Ordering } from "@/lib/estate/yearly-estate-report";
import type { DrillPageOptions } from "../shared/drill-types";

export const ESTATE_DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

// Input shape every estate view-model receives from the registry. Unlike the
// cash-flow drills it carries the full ProjectionResult (estate builders need
// it for ordering resolution + gift ledger + death events).
export interface EstateDrillInput {
  projection: ProjectionResult;
  clientData: ClientData;
  options: DrillPageOptions;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export function deriveOwnerInfo(
  clientData: ClientData,
  clientName: string,
  spouseName: string | null,
): {
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string | null; spouseDob: string | null };
} {
  const ci = clientData.client;
  return {
    ownerNames: { clientName, spouseName },
    ownerDobs: {
      clientDob: ci.dateOfBirth ?? null,
      spouseDob: ci.spouseDob ?? null,
    },
  };
}

// Default ordering = whoever actually dies first in the projected plan.
export function naturalOrdering(projection: ProjectionResult): Ordering {
  return projection.firstDeathEvent?.deceased === "spouse"
    ? "spouseFirst"
    : "primaryFirst";
}

export function estateCallout(
  options: DrillPageOptions,
): string | undefined {
  if (!options.showCallout) return undefined;
  return options.calloutText ?? undefined;
}

export function parseBirthYear(dob: string | null): number | null {
  if (!dob) return null;
  const y = new Date(dob).getUTCFullYear();
  return Number.isFinite(y) ? y : null;
}
