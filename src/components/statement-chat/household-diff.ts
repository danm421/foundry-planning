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

/**
 * `client_household`'s labels are written for the Details screen, which shows
 * them in a client section and a co-client section. This flat table throws that
 * grouping away, so `email` and `spouseEmail` both arrive as "Email" and the
 * advisor cannot tell whose is whose. Name the co-client's side — unless the
 * label already does, which it does for `spouseName`, `spouseDob` and friends.
 *
 * The KEY still says `spouse` (it is the PUT's payload key and the DB's own
 * vocabulary); only the words the advisor reads say co-client.
 */
function qualifyLabel(key: string, label: string): string {
  return key.startsWith("spouse") && !label.toLowerCase().startsWith("co-client")
    ? `Co-client ${label}`
    : label;
}

/**
 * A label built from the payload key, for the rows whose map labels collide.
 *
 * Read as English, not as a token: `spouseAddressLine1` becomes "Co-client
 * Address line 1", which is what distinguishes it from the legacy
 * `spouseAddress` ("Co-client Address"). The raw key used to be appended in
 * brackets instead, which shipped a developer identifier into advisor-facing
 * copy ("Address line 1 (spouseAddressLine1)").
 *
 * The `spouse` prefix is stripped before the words are split and handed back
 * to `qualifyLabel`, so the co-client's side is named the same way everywhere.
 */
function labelFromKey(key: string): string {
  const stem = key.startsWith("spouse") ? key.slice("spouse".length) : key;
  const words = stem
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .trim()
    .toLowerCase();
  return qualifyLabel(key, words.charAt(0).toUpperCase() + words.slice(1));
}

/** One row per field the document states and the record does not already agree with. */
export function buildHouseholdDiff(args: {
  entity: DetailEntity;
  extracted: CandidateRow;
  onRecord: Record<string, unknown>;
}): HouseholdDiffRow[] {
  const { entity, extracted, onRecord } = args;
  // `writable: false` fields are dropped from the update body by the writer
  // (`build-request.ts:99`), so a row the advisor accepted would silently do
  // nothing. NOT `askableFields()`: that also strips `appliesTo: "update"`
  // fields, which the update leg legitimately accepts.
  const labels = new Map(
    entity.fields
      .filter((f) => f.writable !== false)
      .map((f) => [f.key, qualifyLabel(f.key, f.label)]),
  );

  const rows = extracted.values
    .filter((v) => labels.has(v.key) && !same(onRecord[v.key], v.value))
    .map((v) => ({
      key: v.key,
      label: labels.get(v.key) ?? v.key,
      onRecord: onRecord[v.key] ?? null,
      found: v.value,
      issue: v.issue,
      movesPlanHorizon: HORIZON_KEYS.has(v.key),
    }));

  // Naming the co-client only halves it: `addressLine1`, the legacy `address`,
  // `spouseAddressLine1` and the legacy `spouseAddress` ALL read "Address
  // line 1". Anything still sharing a label with another emitted row is named
  // from its key instead — which no two fields of this entity share, pinned by
  // this module's own test over the real `client_household` map.
  const emitted = rows.map((r) => r.label);
  return rows.map((r) =>
    emitted.indexOf(r.label) === emitted.lastIndexOf(r.label)
      ? r
      : { ...r, label: labelFromKey(r.key) },
  );
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
