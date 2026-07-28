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
