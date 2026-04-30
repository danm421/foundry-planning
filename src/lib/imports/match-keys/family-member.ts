import type { ExtractedDependent } from "@/lib/extraction/types";
import type { MatchAnnotation } from "../types";

export interface FamilyMemberCandidate {
  id: string;
  firstName: string;
  lastName: string | null;
  dateOfBirth: string | null;
}

export function matchFamilyMember(
  incoming: ExtractedDependent,
  existing: FamilyMemberCandidate[],
): MatchAnnotation {
  const incomingFirst = incoming.firstName.toLowerCase();
  const incomingLast = (incoming.lastName ?? "").toLowerCase();
  const incomingDob = incoming.dateOfBirth ?? null;

  if (incomingDob) {
    const exact = existing.find(
      (m) =>
        m.firstName.toLowerCase() === incomingFirst &&
        (m.lastName ?? "").toLowerCase() === incomingLast &&
        m.dateOfBirth === incomingDob,
    );
    if (exact) return { kind: "exact", existingId: exact.id };
  }

  const candidates: Array<{ id: string; score: number }> = [];
  for (const m of existing) {
    if (m.firstName.toLowerCase() !== incomingFirst) continue;
    if ((m.lastName ?? "").toLowerCase() !== incomingLast) continue;
    candidates.push({ id: m.id, score: 1 });
  }

  if (candidates.length === 0) return { kind: "new" };
  return { kind: "fuzzy", candidates: candidates.slice(0, 5) };
}
