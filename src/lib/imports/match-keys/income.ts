import type { ExtractedIncome, IncomeType } from "@/lib/extraction/types";
import { boundedLevenshtein } from "../levenshtein";
import type { MatchAnnotation } from "../types";

export interface IncomeCandidate {
  id: string;
  type: IncomeType;
  name: string;
  owner: "client" | "spouse" | "joint";
}

const NAME_BOUND = 3;

export function matchIncome(
  incoming: ExtractedIncome,
  existing: IncomeCandidate[],
): MatchAnnotation {
  if (!incoming.type || !incoming.owner) return { kind: "new" };
  const incomingType = incoming.type;
  const incomingOwner = incoming.owner;
  const incomingName = incoming.name.toLowerCase();

  for (const i of existing) {
    if (i.type === incomingType && i.owner === incomingOwner && i.name.toLowerCase() === incomingName) {
      return { kind: "exact", existingId: i.id };
    }
  }

  const candidates: Array<{ id: string; score: number }> = [];
  for (const i of existing) {
    if (i.type !== incomingType || i.owner !== incomingOwner) continue;
    const dist = boundedLevenshtein(i.name.toLowerCase(), incomingName, NAME_BOUND);
    if (dist < 0) continue;
    candidates.push({ id: i.id, score: 1 - dist / (NAME_BOUND + 1) });
  }

  if (candidates.length === 0) return { kind: "new" };
  candidates.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: candidates.slice(0, 5) };
}
