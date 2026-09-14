// src/components/statement-chat/commit-map-row.ts
import type { DetailEntity } from "@/domain/forge/detail-fields";
import type { CandidateRow } from "@/lib/entity-extraction/types";
import { buildWriteRequest } from "@/lib/entity-writer";

export type CommitOutcome =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

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

  return { ok: true, warnings: request.warnings };
}
