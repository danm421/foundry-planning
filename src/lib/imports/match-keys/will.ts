import type { ExtractedWill } from "@/lib/extraction/types";
import type { MatchAnnotation } from "../types";

export interface WillCandidate {
  id: string;
  grantor: "client" | "spouse";
}

/**
 * Wills have a unique (clientId, grantor) index, so each grantor can have
 * at most one will. Match purely on grantor: an existing row with the
 * same grantor is the canonical match, otherwise it's new. No fuzzy tier.
 */
export function matchWill(
  incoming: ExtractedWill,
  existing: WillCandidate[],
): MatchAnnotation {
  const exact = existing.find((w) => w.grantor === incoming.grantor);
  if (exact) return { kind: "exact", existingId: exact.id };
  return { kind: "new" };
}
