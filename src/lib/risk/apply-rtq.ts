// src/lib/risk/apply-rtq.ts
import { RTQ_VERSION } from "./rtq";
import type { ProfilePatch } from "./profile";

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
