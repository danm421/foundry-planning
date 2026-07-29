// src/lib/risk/apply-rtq.ts
import { RTQ_VERSION } from "./rtq";
import { BAND_CENTERS } from "./scoring";
import type { RiskLevel } from "@/lib/risk-levels";
import type { ProfilePatch } from "./profile";

/**
 * The patch an advisor-STATED rung produces, as opposed to a scored sitting.
 * A rung is a band, not a measurement, so it maps to that band's center; there
 * is no questionnaire behind it, hence `rtqVersion: null`.
 *
 * Shared by every path that lets an advisor assert a rung directly -- the
 * manual-tolerance route and the import commit -- so the two cannot drift on
 * what "stated manually" means. Same role `applyRtqPatch` plays for scored
 * sittings.
 */
export function manualTolerancePatch(level: RiskLevel): ProfilePatch {
  return {
    toleranceScore: BAND_CENTERS[level],
    toleranceSource: "manual",
    toleranceConfirmedAt: new Date(),
    rtqVersion: null,
  };
}

/**
 * Household tolerance is the LOWER of the two spouse scores. Consistent with
 * the governing-constraint model: the household cannot comfortably run at a
 * risk level one partner will not stomach. Both scores stay visible so the
 * advisor sees the disagreement.
 */
export function applyRtqPatch(args: {
  subject: "primary" | "spouse";
  score: number;
  existingPrimaryScore?: number | null;
  existingSpouseScore?: number | null;
}): ProfilePatch {
  const now = new Date();
  if (args.subject === "primary") {
    const spouse = args.existingSpouseScore ?? null;
    return {
      toleranceScore: spouse === null ? args.score : Math.min(args.score, spouse),
      toleranceConfirmedAt: now,
      rtqVersion: RTQ_VERSION,
    };
  }
  const primary = args.existingPrimaryScore ?? null;
  return {
    spouseToleranceScore: args.score,
    spouseRtqVersion: RTQ_VERSION,
    toleranceScore: primary === null ? args.score : Math.min(args.score, primary),
    toleranceConfirmedAt: now,
  };
}
