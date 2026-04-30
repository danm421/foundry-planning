import type { EntityType, ExtractedEntity } from "@/lib/extraction/types";
import { boundedLevenshtein } from "../levenshtein";
import type { MatchAnnotation } from "../types";

export interface EntityCandidate {
  id: string;
  name: string;
  entityType: EntityType;
}

const NAME_BOUND = 2;

export function matchEntity(
  incoming: ExtractedEntity,
  existing: EntityCandidate[],
): MatchAnnotation {
  const incomingName = incoming.name.toLowerCase();

  for (const ent of existing) {
    if (ent.name.toLowerCase() === incomingName) {
      return { kind: "exact", existingId: ent.id };
    }
  }

  if (!incoming.entityType) return { kind: "new" };
  const incomingType = incoming.entityType;

  const candidates: Array<{ id: string; score: number }> = [];
  for (const ent of existing) {
    if (ent.entityType !== incomingType) continue;
    const dist = boundedLevenshtein(ent.name.toLowerCase(), incomingName, NAME_BOUND);
    if (dist < 0) continue;
    candidates.push({ id: ent.id, score: 1 - dist / (NAME_BOUND + 1) });
  }

  if (candidates.length === 0) return { kind: "new" };
  candidates.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: candidates.slice(0, 5) };
}
