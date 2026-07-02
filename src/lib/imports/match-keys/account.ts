import type { AccountCategory, ExtractedAccount } from "@/lib/extraction/types";
import { boundedLevenshtein } from "../levenshtein";
import type { MatchAnnotation } from "../types";

export interface AccountCandidate {
  id: string;
  name: string;
  // Wider than the extraction AccountCategory: existing DB accounts can be
  // education_savings, but extraction never emits that category (v1 classifies
  // 529s as taxable + subType "529"). Keeping 529s in the candidate set lets
  // the exact accountNumberLast4+custodian branch below recognize a re-imported
  // 529 as an update instead of duplicating it; the fuzzy branch requires
  // category equality, so a 529 candidate can never fuzzy-match.
  category: AccountCategory | "education_savings";
  accountNumberLast4: string | null;
  custodian: string | null;
  value: number;
}

const NAME_BOUND = 3;
const VALUE_DELTA_MAX = 0.3;

export function matchAccount(
  incoming: ExtractedAccount,
  existing: AccountCandidate[],
): MatchAnnotation {
  if (incoming.accountNumberLast4 && incoming.custodian) {
    const target = incoming.custodian.toLowerCase();
    const exact = existing.find(
      (a) =>
        a.accountNumberLast4 === incoming.accountNumberLast4 &&
        (a.custodian ?? "").toLowerCase() === target,
    );
    if (exact) return { kind: "exact", existingId: exact.id };
  }

  if (incoming.value === undefined || !incoming.category) return { kind: "new" };
  const incomingValue = incoming.value;
  const incomingCategory = incoming.category;
  const incomingName = incoming.name.toLowerCase();

  const candidates: Array<{ id: string; score: number }> = [];
  for (const a of existing) {
    if (a.category !== incomingCategory) continue;
    const baseValue = Math.max(a.value, 1);
    const valueDelta = Math.abs(a.value - incomingValue) / baseValue;
    if (valueDelta > VALUE_DELTA_MAX) continue;
    const dist = boundedLevenshtein(a.name.toLowerCase(), incomingName, NAME_BOUND);
    if (dist < 0) continue;
    candidates.push({ id: a.id, score: 1 - dist / (NAME_BOUND + 1) });
  }

  if (candidates.length === 0) return { kind: "new" };
  candidates.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: candidates.slice(0, 5) };
}
