import type { ExpenseType, ExtractedExpense } from "@/lib/extraction/types";
import { boundedLevenshtein } from "../levenshtein";
import type { MatchAnnotation } from "../types";

export interface ExpenseCandidate {
  id: string;
  type: ExpenseType;
  name: string;
}

const NAME_BOUND = 3;

export function matchExpense(
  incoming: ExtractedExpense,
  existing: ExpenseCandidate[],
): MatchAnnotation {
  if (!incoming.type) return { kind: "new" };
  const incomingType = incoming.type;
  const incomingName = incoming.name.toLowerCase();

  for (const e of existing) {
    if (e.type === incomingType && e.name.toLowerCase() === incomingName) {
      return { kind: "exact", existingId: e.id };
    }
  }

  const candidates: Array<{ id: string; score: number }> = [];
  for (const e of existing) {
    if (e.type !== incomingType) continue;
    const dist = boundedLevenshtein(e.name.toLowerCase(), incomingName, NAME_BOUND);
    if (dist < 0) continue;
    candidates.push({ id: e.id, score: 1 - dist / (NAME_BOUND + 1) });
  }

  if (candidates.length === 0) return { kind: "new" };
  candidates.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: candidates.slice(0, 5) };
}
