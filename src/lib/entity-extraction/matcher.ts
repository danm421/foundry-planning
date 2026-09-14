// src/lib/entity-extraction/matcher.ts
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { MatchAnnotation } from "@/lib/imports/types";
import type { CandidateRow } from "./types";

export type ExistingRow = { id: string; values: Record<string, unknown> };

/** Fraction of identity fields that must agree before a row is offered as fuzzy. */
const FUZZY_FLOOR = 0.5;
const MAX_FUZZY_CANDIDATES = 5;

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text || null;
  }
  return String(value);
}

/**
 * Match a candidate row against the client's existing rows using the entity's
 * declared identity fields.
 *
 * Entities with a hand-written matcher in `src/lib/imports/match-keys/` do not
 * come here — those encode domain judgement (weighted name/owner/custodian
 * ladders, face-value tolerances) that a generic key cannot express. An entity
 * with no `identity` is create-only and always reports "new".
 */
export function matchByIdentity(
  entity: DetailEntity,
  row: CandidateRow,
  existing: ExistingRow[],
): MatchAnnotation {
  const identity = entity.identity;
  if (!identity?.length || existing.length === 0) return { kind: "new" };

  // A flagged value is not evidence of anything, so it cannot identify a row.
  const incoming = new Map<string, string>();
  for (const key of identity) {
    const observation = row.values.find((v) => v.key === key && !v.issue);
    const text = normalize(observation?.value);
    if (text) incoming.set(key, text);
  }
  if (incoming.size !== identity.length) return { kind: "new" };

  const scored: Array<{ id: string; score: number }> = [];
  for (const candidate of existing) {
    let agreed = 0;
    for (const key of identity) {
      if (normalize(candidate.values[key]) === incoming.get(key)) agreed += 1;
    }
    if (agreed === identity.length) return { kind: "exact", existingId: candidate.id };
    const score = agreed / identity.length;
    if (score >= FUZZY_FLOOR) scored.push({ id: candidate.id, score });
  }

  if (scored.length === 0) return { kind: "new" };
  scored.sort((a, b) => b.score - a.score);
  return { kind: "fuzzy", candidates: scored.slice(0, MAX_FUZZY_CANDIDATES) };
}
