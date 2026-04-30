import type { ExtractedLiability } from "@/lib/extraction/types";
import { boundedLevenshtein } from "../levenshtein";
import type { MatchAnnotation } from "../types";

export interface LiabilityCandidate {
  id: string;
  name: string;
  balance: number;
}

const NAME_BOUND = 3;
const BALANCE_DELTA_MAX = 0.05;

export function matchLiability(
  incoming: ExtractedLiability,
  existing: LiabilityCandidate[],
): MatchAnnotation {
  const incomingName = incoming.name.toLowerCase();

  if (incoming.balance !== undefined) {
    const incomingBalance = incoming.balance;
    for (const li of existing) {
      if (li.name.toLowerCase() !== incomingName) continue;
      const baseBalance = Math.max(li.balance, 1);
      const balanceDelta = Math.abs(li.balance - incomingBalance) / baseBalance;
      if (balanceDelta <= BALANCE_DELTA_MAX) {
        return { kind: "exact", existingId: li.id };
      }
    }
  }

  const candidates: Array<{ id: string; score: number }> = [];
  for (const li of existing) {
    const dist = boundedLevenshtein(li.name.toLowerCase(), incomingName, NAME_BOUND);
    if (dist < 0) continue;
    candidates.push({ id: li.id, score: 1 - dist / (NAME_BOUND + 1) });
  }

  if (candidates.length === 0) return { kind: "new" };
  candidates.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: candidates.slice(0, 5) };
}
