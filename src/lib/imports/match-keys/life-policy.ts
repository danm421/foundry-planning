import type { ExtractedLifePolicy, LifePolicyType } from "@/lib/extraction/types";
import type { MatchAnnotation } from "../types";

export interface LifePolicyCandidate {
  id: string;
  carrier: string | null;
  policyNumberLast4: string | null;
  insuredPerson: "client" | "spouse" | "joint";
  policyType: LifePolicyType;
  faceValue: number;
}

const FACE_VALUE_DELTA_MAX = 0.1;

export function matchLifePolicy(
  incoming: ExtractedLifePolicy,
  existing: LifePolicyCandidate[],
): MatchAnnotation {
  if (incoming.carrier && incoming.policyNumberLast4) {
    const target = incoming.carrier.toLowerCase();
    const exact = existing.find(
      (p) =>
        (p.carrier ?? "").toLowerCase() === target &&
        p.policyNumberLast4 === incoming.policyNumberLast4,
    );
    if (exact) return { kind: "exact", existingId: exact.id };
  }

  const candidates: Array<{ id: string; score: number }> = [];
  for (const p of existing) {
    if (p.insuredPerson !== incoming.insuredPerson) continue;
    if (p.policyType !== incoming.policyType) continue;
    const baseFace = Math.max(p.faceValue, 1);
    const delta = Math.abs(p.faceValue - incoming.faceValue) / baseFace;
    if (delta > FACE_VALUE_DELTA_MAX) continue;
    candidates.push({ id: p.id, score: 1 - delta });
  }

  if (candidates.length === 0) return { kind: "new" };
  candidates.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: candidates.slice(0, 5) };
}
