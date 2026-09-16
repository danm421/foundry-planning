// src/components/statement-chat/commit-map-row.ts
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { buildWriteRequest } from "@/lib/entity-writer";

export type CommitOutcome =
  | { ok: true; warnings: string[]; createdId: string | null }
  | { ok: false; error: string };

/**
 * The id of the record the create route just wrote, or null when the response
 * does not say.
 *
 * The routes do not agree on a shape — `/insurance-policies` returns `{ id }`
 * (route.ts:230), `/disability-policies` returns `{ policy: { … } }`
 * (route.ts:105) — so both are read, and NOTHING beyond them. A guessed id is
 * worse than none: the caller stamps it onto the extracted row as
 * `match.existingId`, so a wrong id makes the row read "already committed"
 * forever while the real record is never touched again.
 */
function readCreatedId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  // Exactly ONE top-level value, and it carries the id: an envelope with a
  // single payload is unambiguous. Two or more and picking one is a guess.
  const values = Object.values(record);
  if (values.length !== 1) return null;
  const only = values[0];
  if (typeof only !== "object" || only === null) return null;
  const inner = (only as Record<string, unknown>).id;
  return typeof inner === "string" ? inner : null;
}

/**
 * Write one accepted row by posting the built request to the entity's OWN
 * route.
 *
 * Not a generic table insert: a life insurance policy is two rows (an
 * `accounts` row plus a `lifeInsurancePolicies` row keyed to it), and only the
 * route knows that. Going through the route is what makes this correct for
 * every entity without per-entity code here.
 */
export async function commitMapRow(args: {
  clientId: string;
  entity: DetailEntity;
  row: CandidateRow;
  /** Current rows — REQUIRED for a set-replacing entity, or the write refuses. */
  existingSet?: Record<string, unknown>[];
}): Promise<CommitOutcome> {
  const { clientId, entity, row, existingSet } = args;

  const request = buildWriteRequest({ entity, row, existingSet });
  if (!request.ok) return { ok: false, error: request.error };

  // A map route can be a template (`/accounts/[accountId]/beneficiaries`)
  // when it is only ever reached nested under an existing record. Posting
  // that literally produces `/api/clients/c1/accounts/[accountId]/...` — a
  // 404 that tells the advisor nothing. Refuse before the network call and
  // name the entity and the segment instead.
  const unresolved = request.path.match(/\[[^\]]+\]/);
  if (unresolved) {
    return {
      ok: false,
      error: `${entity.id} cannot be written: its route ${request.path} has an unresolved ${unresolved[0]} segment.`,
    };
  }

  let response: Response;
  try {
    response = await fetch(`/api/clients/${clientId}${request.path}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network request failed" };
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // A non-JSON error body is not worth a second failure mode.
    }
    return { ok: false, error: message };
  }

  // The write has LANDED by here — every path below reports success. A body
  // this cannot read an id out of is a bookkeeping gap, not a failed write,
  // and calling it a failure would send the advisor back to click Commit a
  // second time, creating the duplicate this id exists to prevent.
  const body = await response.json().catch(() => null);
  // An UPDATE already knows its id — it came from the match — and an update
  // route need not return one at all. Without this every successful
  // correction ended with the duplicate warning below, whose two halves are
  // both false for an update: the record IS identified, and re-committing
  // overwrites the same row rather than adding a second.
  //
  // Conditioned on `entity.updateSemantics`, NOT on the method: a
  // `payloadShape: "array"` entity also PUTs, and its write replaces the
  // whole set, which carries none of an update's guarantees.
  const updatedId =
    entity.updateSemantics && row.match?.kind === "exact" ? row.match.existingId : null;
  const createdId = updatedId ?? readCreatedId(body);
  const warnings = [...request.warnings];
  if (createdId === null) {
    warnings.push(
      "This row was written, but the response did not identify the new record, " +
        "so it could not be marked as committed. Committing it again would create a duplicate.",
    );
  }

  return { ok: true, warnings, createdId };
}
