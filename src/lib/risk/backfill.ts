import type { RiskLevel } from "@/lib/risk-levels";
import { BAND_CENTERS } from "./scoring";
import type { ProfilePatch } from "./profile";

export interface BackfillSource {
  id: string;
  firmId: string;
  riskTolerance: RiskLevel | null;
  updatedAt: Date;
}

export interface BackfillEntry {
  clientId: string;
  firmId: string;
  originalLevel: RiskLevel;
  patch: ProfilePatch;
}

/**
 * Map each client's hand-set rung to its band center. Because capacity stays
 * null until the first compute, the composite equals the tolerance and band()
 * returns the original rung -- nobody's level moves on day one.
 */
export function planBackfill(rows: BackfillSource[]): BackfillEntry[] {
  const out: BackfillEntry[] = [];
  for (const r of rows) {
    if (!r.riskTolerance) continue;
    out.push({
      clientId: r.id,
      firmId: r.firmId,
      originalLevel: r.riskTolerance,
      patch: {
        toleranceScore: BAND_CENTERS[r.riskTolerance],
        toleranceSource: "manual",
        toleranceConfirmedAt: r.updatedAt,
        environmentAdj: 0,
      },
    });
  }
  return out;
}

/**
 * Drop entries for clients that already have a risk profile row.
 *
 * This is not just re-run hygiene. A profile can already exist from a
 * completed RTQ or a prior manual edit; blindly writing this script's
 * band-center estimate over it would destroy real data with a coarser one.
 * It also makes the backfill script safe to re-run after a partial failure:
 * recomputeProfile's upsert is idempotent for the client_risk_profiles row,
 * but it always logs a profile_created event -- shouldLogEvent only
 * suppresses capacity_changed -- so without this filter a re-run would
 * double-log the suitability audit trail for every already-processed client.
 */
export function excludeAlreadyProfiled(
  entries: BackfillEntry[],
  existingProfileClientIds: ReadonlySet<string>,
): BackfillEntry[] {
  return entries.filter((e) => !existingProfileClientIds.has(e.clientId));
}
