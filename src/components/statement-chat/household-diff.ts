// src/components/statement-chat/household-diff.ts
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow, Observation, ValueIssue } from "@/lib/entity-extraction/types";

/**
 * The four keys whose acceptance re-derives `planEndAge` and pushes a new
 * `planEndYear` into EVERY scenario's plan settings
 * (`src/app/api/clients/[id]/route.ts:122`). A name correction is cosmetic;
 * these move the plan horizon, and the advisor must be told before accepting.
 */
const HORIZON_KEYS = new Set(["dateOfBirth", "spouseDob", "lifeExpectancy", "spouseLifeExpectancy"]);

export interface HouseholdDiffRow {
  key: string;
  label: string;
  onRecord: unknown;
  found: unknown;
  issue?: ValueIssue;
  movesPlanHorizon: boolean;
}

function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : String(v).trim().toLowerCase();
  return norm(a) === norm(b);
}

/** One row per field the document states and the record does not already agree with. */
export function buildHouseholdDiff(args: {
  entity: DetailEntity;
  extracted: CandidateRow;
  onRecord: Record<string, unknown>;
}): HouseholdDiffRow[] {
  const { entity, extracted, onRecord } = args;
  const labels = new Map(entity.fields.map((f) => [f.key, f.label]));

  return extracted.values
    .filter((v) => labels.has(v.key) && !same(onRecord[v.key], v.value))
    .map((v) => ({
      key: v.key,
      label: labels.get(v.key) ?? v.key,
      onRecord: onRecord[v.key] ?? null,
      found: v.value,
      issue: v.issue,
      movesPlanHorizon: HORIZON_KEYS.has(v.key),
    }));
}

/**
 * A `CandidateRow` carrying ONLY the accepted fields, marked as an exact match
 * on the client itself.
 *
 * The household is a singleton with no create route, so it never goes through
 * `matchByIdentity`. Stating the match here is what routes it to the update leg
 * rather than a create the route does not have — and it keeps the household on
 * the same writer, the same validation and the same audit path as every other
 * row on this surface.
 */
export function buildHouseholdCommitRow(args: {
  clientId: string;
  extracted: CandidateRow;
  acceptedKeys: string[];
}): CandidateRow {
  const { clientId, extracted, acceptedKeys } = args;
  const accepted = new Set(acceptedKeys);
  const values: Observation[] = extracted.values.filter((v) => accepted.has(v.key));
  return {
    entityId: extracted.entityId,
    rowId: extracted.rowId,
    values,
    missingRequired: [],
    rowConfidence: extracted.rowConfidence,
    match: { kind: "exact", existingId: clientId },
  };
}
